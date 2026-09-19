/**
 * Trabajo: tarea, paso, delegación, aprobación y disparador.
 *
 * El estado de la tarea lo dicta el historial de Temporal; aquí vive una proyección
 * para el panel que se puede reconstruir. Las delegaciones e intervenciones cuentan
 * dentro de su tarea raíz.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { columnasInmutables, columnasMutables, idPrimario, tenantId } from './columnas.js';
import {
  decisionAprobacion,
  estadoTarea,
  nivelAutonomia,
  origenTarea,
  resultadoAccion,
  tipoDisparador,
} from './enumeraciones.js';
import { puesto, versionPuesto } from './equipo.js';
import { organizacion, persona } from './organizacion.js';

export const tarea = pgTable(
  'tarea',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    /** Raíz de consumo: las delegaciones y las intervenciones suman a esta tarea. */
    tareaRaizId: uuid('tarea_raiz_id').references((): AnyPgColumn => tarea.id, {
      onDelete: 'restrict',
    }),
    tareaPadreId: uuid('tarea_padre_id').references((): AnyPgColumn => tarea.id, {
      onDelete: 'restrict',
    }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    versionPuestoId: uuid('version_puesto_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    origen: origenTarea('origen').notNull(),
    /** Identificador de la sala, el canal, el disparador o la delegación que la abrió. */
    origenReferenciaId: uuid('origen_referencia_id'),
    /** Proyección del historial de Temporal, reconstruible. No es la verdad. */
    estado: estadoTarea('estado').notNull().default('pendiente'),
    flujoTemporalId: text('flujo_temporal_id'),
    ejecucionTemporalId: text('ejecucion_temporal_id'),
    presupuestoEuros: numeric('presupuesto_euros', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    costeEuros: numeric('coste_euros', { precision: 12, scale: 4 }).notNull().default('0'),
    resultado: jsonb('resultado').notNull().default({}),
    proyectadoEn: timestamp('proyectado_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    index('tarea_tenant_estado_creado_idx').on(t.tenantId, t.estado, t.creadoEn),
    index('tarea_tenant_puesto_creado_idx').on(t.tenantId, t.puestoId, t.creadoEn),
    index('tarea_tenant_raiz_idx').on(t.tenantId, t.tareaRaizId),
    index('tarea_tenant_creado_idx').on(t.tenantId, t.creadoEn),
  ],
);

/** Cada paso referencia la versión de puesto con la que se ejecutó. */
export const paso = pgTable(
  'paso',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tareaId: uuid('tarea_id')
      .notNull()
      .references(() => tarea.id, { onDelete: 'restrict' }),
    versionPuestoId: uuid('version_puesto_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    numero: integer('numero').notNull(),
    tipo: text('tipo').notNull(),
    herramienta: text('herramienta'),
    entrada: jsonb('entrada').notNull().default({}),
    salida: jsonb('salida').notNull().default({}),
    resultado: resultadoAccion('resultado').notNull().default('exito'),
    costeEuros: numeric('coste_euros', { precision: 12, scale: 4 }).notNull().default('0'),
    duracionMs: integer('duracion_ms').notNull().default(0),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('paso_tenant_tarea_numero_key').on(t.tenantId, t.tareaId, t.numero),
    index('paso_tenant_creado_idx').on(t.tenantId, t.creadoEn),
  ],
);

/** Contrato de la delegación: encargo, plazo, presupuesto y formato. Es un flujo hijo. */
export const delegacion = pgTable(
  'delegacion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tareaOrigenId: uuid('tarea_origen_id')
      .notNull()
      .references(() => tarea.id, { onDelete: 'restrict' }),
    tareaDestinoId: uuid('tarea_destino_id').references(() => tarea.id, { onDelete: 'restrict' }),
    puestoOrigenId: uuid('puesto_origen_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    puestoDestinoId: uuid('puesto_destino_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    encargo: text('encargo').notNull(),
    plazo: timestamp('plazo', { withTimezone: true }),
    presupuestoEuros: numeric('presupuesto_euros', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    formato: jsonb('formato').notNull().default({}),
    /** Se comprueba contra la política de cruce cuando cambia de departamento. */
    cruzaDepartamento: boolean('cruza_departamento').notNull().default(false),
    resultado: jsonb('resultado').notNull().default({}),
    ...columnasMutables(),
  },
  (t) => [
    index('delegacion_tenant_origen_idx').on(t.tenantId, t.tareaOrigenId),
    index('delegacion_tenant_destino_idx').on(t.tenantId, t.puestoDestinoId, t.creadoEn),
  ],
);

/**
 * Borrador opaco, resumen legible, decisión, motivo, persona y fecha.
 * Fila inmutable: la decisión se inserta una vez y es la señal de aprendizaje más valiosa.
 */
export const aprobacion = pgTable(
  'aprobacion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tareaId: uuid('tarea_id')
      .notNull()
      .references(() => tarea.id, { onDelete: 'restrict' }),
    pasoId: uuid('paso_id').references(() => paso.id, { onDelete: 'restrict' }),
    personaId: uuid('persona_id').references(() => persona.id, { onDelete: 'restrict' }),
    claseAccion: text('clase_accion').notNull(),
    nivelExigido: nivelAutonomia('nivel_exigido').notNull(),
    /** Carga opaca para el plano de control (ADR-001): no se interpreta aquí. */
    borradorOpaco: jsonb('borrador_opaco').notNull().default({}),
    resumenLegible: text('resumen_legible').notNull(),
    decision: decisionAprobacion('decision').notNull().default('pendiente'),
    motivo: text('motivo'),
    edicionPrevia: jsonb('edicion_previa'),
    decididaEn: timestamp('decidida_en', { withTimezone: true }),
    ...columnasInmutables(),
  },
  (t) => [
    index('aprobacion_tenant_decision_idx').on(t.tenantId, t.decision, t.creadoEn),
    index('aprobacion_tenant_tarea_idx').on(t.tenantId, t.tareaId),
    index('aprobacion_tenant_persona_idx').on(t.tenantId, t.personaId, t.creadoEn),
  ],
);

/** Activar o pausar un disparador es una operación de organización, no un despliegue. */
export const disparador = pgTable(
  'disparador',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tipo: tipoDisparador('tipo').notNull(),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    propietarioPersonaId: uuid('propietario_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    nivel: nivelAutonomia('nivel').notNull().default('n0'),
    presupuestoEuros: numeric('presupuesto_euros', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    configuracion: jsonb('configuracion').notNull().default({}),
    activo: boolean('activo').notNull().default(false),
    disparosAcumulados: bigint('disparos_acumulados', { mode: 'number' }).notNull().default(0),
    ...columnasMutables(),
  },
  (t) => [
    index('disparador_tenant_activo_idx').on(t.tenantId, t.activo, t.tipo),
    index('disparador_tenant_puesto_idx').on(t.tenantId, t.puestoId),
  ],
);
