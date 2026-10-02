/**
 * La organización es dato, nunca código: departamentos, puestos, versiones y habilidades.
 *
 * Relación clave del plan: Organización 1:N Departamento 1:N Puesto 1:N Versión de puesto,
 * y el puesto apunta a su versión activa. La versión de puesto es inmutable: es la unidad
 * de reversión y de auditoría del aprendizaje.
 */
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { columnasInmutables, columnasMutables, idPrimario, tenantId } from './columnas.js';
import { claseRiesgo, estadoDepartamento, estadoPuesto } from './enumeraciones.js';
import { organizacion, persona } from './organizacion.js';

export const departamento = pgTable(
  'departamento',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    nombre: text('nombre').notNull(),
    /** Hereda la brand voice de la organización y la sobrescribe por campos, con versión. */
    brandVoice: jsonb('brand_voice').notNull().default({}),
    versionBrandVoice: bigint('version_brand_voice', { mode: 'number' }).notNull().default(1),
    supervisorPersonaId: uuid('supervisor_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    supervisorPuestoId: uuid('supervisor_puesto_id').references((): AnyPgColumn => puesto.id, {
      onDelete: 'restrict',
    }),
    presupuestoEuros: numeric('presupuesto_euros', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    memoriaCompartida: boolean('memoria_compartida').notNull().default(true),
    estado: estadoDepartamento('estado').notNull().default('propuesto'),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('departamento_tenant_nombre_key').on(t.tenantId, t.nombre),
    index('departamento_tenant_estado_idx').on(t.tenantId, t.estado, t.creadoEn),
  ],
);

export const puesto = pgTable(
  'puesto',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    departamentoId: uuid('departamento_id')
      .notNull()
      .references(() => departamento.id, { onDelete: 'restrict' }),
    nombre: text('nombre').notNull(),
    ficha: jsonb('ficha').notNull().default({}),
    claseRiesgo: claseRiesgo('clase_riesgo').notNull().default('bajo'),
    /** Modelo y enrutado: proveedor, modelo, región y alternativas. */
    enrutadoModelo: jsonb('enrutado_modelo').notNull().default({}),
    /** Puntero a la versión activa. Cambiarlo es un clic y deja rastro en auditoría. */
    versionActivaId: uuid('version_activa_id').references((): AnyPgColumn => versionPuesto.id, {
      onDelete: 'restrict',
    }),
    expediente: jsonb('expediente').notNull().default({}),
    estado: estadoPuesto('estado').notNull().default('propuesto'),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('puesto_tenant_departamento_nombre_key').on(t.tenantId, t.departamentoId, t.nombre),
    index('puesto_tenant_estado_idx').on(t.tenantId, t.estado, t.creadoEn),
    index('puesto_tenant_departamento_idx').on(t.tenantId, t.departamentoId, t.creadoEn),
  ],
);

/**
 * Prompt, política, habilidades y memoria congelados. Fila inmutable: cualquier
 * lección promocionada o cambio de política inserta una versión nueva.
 */
export const versionPuesto = pgTable(
  'version_puesto',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    numero: bigint('numero', { mode: 'number' }).notNull(),
    prompt: text('prompt').notNull(),
    /** Política versionada con niveles N0 a N3 por clase de acción. Validada con Zod. */
    politica: jsonb('politica').notNull().default({}),
    habilidadesCongeladas: jsonb('habilidades_congeladas').notNull().default([]),
    memoriaCongelada: jsonb('memoria_congelada').notNull().default({}),
    /** Lecciones que originan la versión y sus resultados de eval. */
    leccionesOrigen: jsonb('lecciones_origen').notNull().default([]),
    resultadosEval: jsonb('resultados_eval').notNull().default({}),
    /**
     * Modelo, esfuerzo por clase de paso y modelo de respaldo (ADR-018). Validada
     * con `configuracionModeloPuesto` de `@aiw/domain`. Igual que `politica`,
     * inmutable como el resto de la fila: bajar de modelo o de esfuerzo es una
     * promoción y crea una versión nueva.
     */
    configuracionModelo: jsonb('configuracion_modelo').notNull().default({}),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('version_puesto_tenant_puesto_numero_key').on(t.tenantId, t.puestoId, t.numero),
    index('version_puesto_tenant_creado_idx').on(t.tenantId, t.creadoEn),
  ],
);

/** Procedimiento versionado con pasos, comprobaciones y casos. Pasa evals antes de activarse. */
export const habilidad = pgTable(
  'habilidad',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    nombre: text('nombre').notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    pasos: jsonb('pasos').notNull().default([]),
    comprobaciones: jsonb('comprobaciones').notNull().default([]),
    casosQueAplican: jsonb('casos_que_aplican').notNull().default([]),
    /** Nombres de herramienta que `pasos` nombra; la puerta del Evaluador los compara con la lista blanca del puesto. */
    herramientas: jsonb('herramientas').notNull().default([]),
    activa: boolean('activa').notNull().default(false),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('habilidad_tenant_nombre_version_key').on(t.tenantId, t.nombre, t.version),
    index('habilidad_tenant_activa_idx').on(t.tenantId, t.activa, t.creadoEn),
  ],
);

/** Habilidad N:M Versión de puesto, con la versión de la habilidad fijada. */
export const habilidadVersionPuesto = pgTable(
  'habilidad_version_puesto',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    habilidadId: uuid('habilidad_id')
      .notNull()
      .references(() => habilidad.id, { onDelete: 'restrict' }),
    versionPuestoId: uuid('version_puesto_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    versionHabilidadFijada: bigint('version_habilidad_fijada', { mode: 'number' }).notNull(),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('habilidad_version_puesto_key').on(t.tenantId, t.habilidadId, t.versionPuestoId),
    index('habilidad_version_puesto_tenant_version_idx').on(t.tenantId, t.versionPuestoId),
  ],
);
