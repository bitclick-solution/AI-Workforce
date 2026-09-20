/**
 * Columnas compartidas por todas las tablas del modelo.
 *
 * Principios del ADR-007 que se aplican aquí:
 * - Identificadores ordenables: UUID v7 generado en la base por `uuid_generar_v7()`.
 * - Tenant en todo: `tenant_id` en toda tabla que no sea raíz de tenant.
 * - Lo que afecta a la auditoría no se actualiza en sitio: las tablas inmutables
 *   usan `columnasInmutables()` y no llevan `actualizado_en`.
 */
import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Ajuste de la conexión que fija el tenant de la sesión. Lo leen las políticas de RLS. */
export const AJUSTE_TENANT = 'aiw.tenant_id';

/**
 * Dimensión de los vectores de memoria y de conocimiento. Encaja con los modelos de
 * embedding europeos y open source. Cambiarla es una migración propia.
 */
export const DIMENSION_EMBEDDING = 1024;

/** Clave primaria UUID v7 generada en la base. */
export const idPrimario = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuid_generar_v7()`);

/** Identificador UUID v7 sin clave primaria, para tablas particionadas. */
export const idParticionado = () =>
  uuid('id')
    .notNull()
    .default(sql`uuid_generar_v7()`);

/** Columna de tenant. La clave foránea a `organizacion` se declara en cada tabla. */
export const tenantId = () => uuid('tenant_id').notNull();

export const creadoEn = () =>
  timestamp('creado_en', { withTimezone: true })
    .notNull()
    .default(sql`now()`);

export const actualizadoEn = () =>
  timestamp('actualizado_en', { withTimezone: true })
    .notNull()
    .default(sql`now()`);

/** Marca de tiempo de las tablas inmutables: se inserta y no se toca. */
export const columnasInmutables = () => ({
  creadoEn: creadoEn(),
});

export const columnasMutables = () => ({
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});
