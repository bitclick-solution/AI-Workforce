/**
 * Esquema del libro de auditoría y del contador.
 *
 * El DDL entra en la migración inicial de `@aiw/domain` porque es una sola base de
 * datos; aquí vive la declaración tipada que usa el punto único de escritura.
 *
 * `entrada_auditoria` está particionada por mes sobre `creado_en`, su clave primaria
 * incluye esa columna, y referencia a cualquier entidad por identificador, nunca por
 * clave foránea, para sobrevivir a purgas y archivados.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  nivelAutonomia,
  resultadoAccion,
  tipoActor,
  columnasMutables,
  creadoEn,
  idParticionado,
  idPrimario,
  tenantId,
} from '@aiw/domain/db';

export const entradaAuditoria = pgTable(
  'entrada_auditoria',
  {
    id: idParticionado(),
    /** Sin clave foránea a `organizacion`: la entrada sobrevive a la purga del tenant. */
    tenantId: uuid('tenant_id').notNull(),
    numeroOrden: bigint('numero_orden', { mode: 'number' }).notNull(),
    actorTipo: tipoActor('actor_tipo').notNull(),
    actorId: uuid('actor_id'),
    puestoId: uuid('puesto_id'),
    versionPuestoId: uuid('version_puesto_id'),
    tareaId: uuid('tarea_id'),
    pasoId: uuid('paso_id'),
    accion: text('accion').notNull(),
    herramienta: text('herramienta'),
    datosReferenciados: jsonb('datos_referenciados').notNull().default([]),
    resultado: resultadoAccion('resultado').notNull(),
    costeEuros: numeric('coste_euros', { precision: 12, scale: 4 }).notNull().default('0'),
    duracionMs: integer('duracion_ms').notNull().default(0),
    aprobadaPorPersonaId: uuid('aprobada_por_persona_id'),
    leccionAplicadaId: uuid('leccion_aplicada_id'),
    nivelAplicado: nivelAutonomia('nivel_aplicado'),
    cambioDeNivel: jsonb('cambio_de_nivel'),
    hashAnterior: text('hash_anterior'),
    hash: text('hash').notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.creadoEn], name: 'entrada_auditoria_pkey' }),
    index('entrada_auditoria_tenant_orden_idx').on(t.tenantId, t.numeroOrden.desc()),
    index('entrada_auditoria_tenant_creado_idx').on(t.tenantId, t.creadoEn.desc()),
    index('entrada_auditoria_tenant_puesto_creado_idx').on(
      t.tenantId,
      t.puestoId,
      t.creadoEn.desc(),
    ),
    index('entrada_auditoria_tenant_tarea_idx').on(t.tenantId, t.tareaId, t.creadoEn.desc()),
  ],
);

/** Contador de consumo por tenant y periodo mensual. Toda acción suma aquí. */
export const contadorConsumo = pgTable(
  'contador_consumo',
  {
    id: idPrimario(),
    tenantId: tenantId(),
    periodo: date('periodo').notNull(),
    tareas: bigint('tareas', { mode: 'number' }).notNull().default(0),
    pasos: bigint('pasos', { mode: 'number' }).notNull().default(0),
    acciones: bigint('acciones', { mode: 'number' }).notNull().default(0),
    costeEuros: numeric('coste_euros', { precision: 14, scale: 4 }).notNull().default('0'),
    ...columnasMutables(),
  },
  (t) => [uniqueIndex('contador_consumo_tenant_periodo_key').on(t.tenantId, t.periodo)],
);

export { sql };
