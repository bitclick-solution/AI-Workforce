/**
 * Aprendizaje: señal, lección, promoción.
 *
 * Toda lección aplicada es trazable hasta la señal que la originó. Lecciones y
 * promociones son filas inmutables; la promoción apunta a la versión de puesto
 * resultante, que es la unidad de reversión.
 *
 * `senal` está particionada por mes en la migración: su clave primaria incluye
 * `creado_en` y ninguna tabla la referencia con clave foránea, solo por identificador.
 */
import {
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { columnasInmutables, creadoEn, idParticionado, idPrimario, tenantId } from './columnas.js';
import { estadoLeccion, tipoSenal } from './enumeraciones.js';
import { puesto, versionPuesto } from './equipo.js';
import { organizacion, persona } from './organizacion.js';

/** Señal N:1 Puesto. Particionada por mes: crece con cada paso y cada aprobación. */
export const senal = pgTable(
  'senal',
  {
    id: idParticionado(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    tipo: tipoSenal('tipo').notNull(),
    origen: text('origen').notNull(),
    /** Referencias por identificador: la aprobación o la tarea que la originó. */
    aprobacionId: uuid('aprobacion_id'),
    tareaId: uuid('tarea_id'),
    contenido: jsonb('contenido').notNull().default({}),
    evaluacion: jsonb('evaluacion').notNull().default({}),
    creadoEn: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.creadoEn], name: 'senal_pkey' }),
    index('senal_tenant_puesto_creado_idx').on(t.tenantId, t.puestoId, t.creadoEn),
    index('senal_tenant_tipo_creado_idx').on(t.tenantId, t.tipo, t.creadoEn),
  ],
);

export const leccion = pgTable(
  'leccion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    titulo: text('titulo').notNull(),
    contenido: jsonb('contenido').notNull().default({}),
    /** Parámetros acotados: memoria, habilidades, rangos y ejemplos. Nunca el modelo base. */
    parametros: jsonb('parametros').notNull().default({}),
    estado: estadoLeccion('estado').notNull().default('propuesta'),
    ...columnasInmutables(),
  },
  (t) => [
    index('leccion_tenant_estado_creado_idx').on(t.tenantId, t.estado, t.creadoEn),
    index('leccion_tenant_puesto_idx').on(t.tenantId, t.puestoId, t.creadoEn),
  ],
);

/** Lección N:M Señal. La señal se referencia por identificador porque está particionada. */
export const leccionSenal = pgTable(
  'leccion_senal',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    leccionId: uuid('leccion_id')
      .notNull()
      .references(() => leccion.id, { onDelete: 'restrict' }),
    senalId: uuid('senal_id').notNull(),
    senalCreadoEn: timestamp('senal_creado_en', { withTimezone: true }).notNull(),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('leccion_senal_key').on(t.tenantId, t.leccionId, t.senalId),
    index('leccion_senal_tenant_senal_idx').on(t.tenantId, t.senalId),
  ],
);

/** Promoción N:1 Lección y N:1 Versión de puesto resultante. Fila inmutable. */
export const promocion = pgTable(
  'promocion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    leccionId: uuid('leccion_id')
      .notNull()
      .references(() => leccion.id, { onDelete: 'restrict' }),
    versionPuestoResultanteId: uuid('version_puesto_resultante_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    decididaPorPersonaId: uuid('decidida_por_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    evidencia: jsonb('evidencia').notNull().default({}),
    resultadosEval: jsonb('resultados_eval').notNull().default({}),
    revertidaEn: timestamp('revertida_en', { withTimezone: true }),
    ...columnasInmutables(),
  },
  (t) => [
    // Red de seguridad de la base: una lección se promociona una sola vez aunque
    // quien inserte no pase por `promocionarLeccion` (migración 0002).
    uniqueIndex('promocion_tenant_leccion_key').on(t.tenantId, t.leccionId),
    index('promocion_tenant_creado_idx').on(t.tenantId, t.creadoEn),
  ],
);

/**
 * Versiones que crea una promoción: una fila por puesto. Solo la escribe una promoción
 * de ámbito departamento (migración 0011); una promoción de puesto no escribe aquí.
 * Fila inmutable.
 */
export const promocionVersion = pgTable(
  'promocion_version',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    promocionId: uuid('promocion_id')
      .notNull()
      .references(() => promocion.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    versionPuestoId: uuid('version_puesto_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    versionAnteriorId: uuid('version_anterior_id')
      .notNull()
      .references(() => versionPuesto.id, { onDelete: 'restrict' }),
    creadoEn: creadoEn(),
  },
  (t) => [
    uniqueIndex('promocion_version_tenant_promocion_puesto_key').on(
      t.tenantId,
      t.promocionId,
      t.puestoId,
    ),
    uniqueIndex('promocion_version_tenant_version_key').on(t.tenantId, t.versionPuestoId),
    index('promocion_version_tenant_puesto_idx').on(t.tenantId, t.puestoId, t.creadoEn),
  ],
);
