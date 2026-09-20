/**
 * Esquema del contador de tareas v0: usos reales de modelo y tarifas versionadas.
 *
 * Igual que el libro, el DDL vive en una migración de `@aiw/db`
 * (`0001_contador_uso_de_modelos`) porque es una sola base de datos; aquí vive la
 * declaración tipada que usan los puntos de escritura y las consultas del panel.
 *
 * Las dos tablas son inmutables: un consumo registrado y un precio aplicado no se
 * editan. Corregir es insertar otra fila (ADR-005, ADR-007), y por eso no llevan
 * `actualizado_en` ni columna de cierre de vigencia.
 */
import {
  bigint,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { columnasInmutables, idPrimario, tenantId } from '@aiw/db';

/**
 * Precio de un modelo como dato del tenant, no como constante del código (ADR-011:
 * los importes son hipótesis que se revisan). La tarifa aplicable a un uso es la de
 * mayor `vigenteDesde` que no sea posterior a él; cerrar una vigencia es insertar
 * la siguiente, nunca actualizar esta.
 */
export const tarifaModelo = pgTable(
  'tarifa_modelo',
  {
    id: idPrimario(),
    tenantId: tenantId(),
    proveedor: text('proveedor').notNull(),
    modelo: text('modelo').notNull(),
    eurosPorMillonEntrada: numeric('euros_por_millon_entrada', {
      precision: 14,
      scale: 6,
    }).notNull(),
    eurosPorMillonSalida: numeric('euros_por_millon_salida', {
      precision: 14,
      scale: 6,
    }).notNull(),
    eurosPorMillonEntradaCache: numeric('euros_por_millon_entrada_cache', {
      precision: 14,
      scale: 6,
    })
      .notNull()
      .default('0'),
    vigenteDesde: timestamp('vigente_desde', { withTimezone: true }).notNull(),
    /** De dónde sale el precio: lista pública, contrato o acuerdo con el partner. */
    fuente: text('fuente').notNull(),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('tarifa_modelo_tenant_modelo_vigencia_key').on(
      t.tenantId,
      t.proveedor,
      t.modelo,
      t.vigenteDesde,
    ),
    index('tarifa_modelo_tenant_vigencia_idx').on(t.tenantId, t.vigenteDesde.desc()),
  ],
);

/**
 * Una llamada al modelo con sus tokens reales y el coste que se le aplicó.
 *
 * El coste se congela aquí junto con la tarifa que lo produjo: cambiar el precio
 * mañana no reescribe lo que costó ayer. `claveIdempotencia` es lo que evita cobrar
 * dos veces cuando Temporal reintenta una actividad, y la única que la respalda la
 * impone la base.
 */
export const usoModelo = pgTable(
  'uso_modelo',
  {
    id: idPrimario(),
    tenantId: tenantId(),
    tareaId: uuid('tarea_id').notNull(),
    /** Raíz de consumo: el coste de una delegación se agrega a la tarea que la pidió. */
    tareaRaizId: uuid('tarea_raiz_id').notNull(),
    pasoId: uuid('paso_id'),
    puestoId: uuid('puesto_id').notNull(),
    versionPuestoId: uuid('version_puesto_id').notNull(),
    proveedor: text('proveedor').notNull(),
    modelo: text('modelo').notNull(),
    tokensEntrada: bigint('tokens_entrada', { mode: 'number' }).notNull().default(0),
    tokensSalida: bigint('tokens_salida', { mode: 'number' }).notNull().default(0),
    tokensEntradaCache: bigint('tokens_entrada_cache', { mode: 'number' }).notNull().default(0),
    llamadas: integer('llamadas').notNull().default(1),
    tarifaModeloId: uuid('tarifa_modelo_id').notNull(),
    costeEuros: numeric('coste_euros', { precision: 12, scale: 4 }).notNull().default('0'),
    claveIdempotencia: text('clave_idempotencia').notNull(),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('uso_modelo_tenant_clave_key').on(t.tenantId, t.claveIdempotencia),
    index('uso_modelo_tenant_creado_idx').on(t.tenantId, t.creadoEn.desc()),
    index('uso_modelo_tenant_raiz_idx').on(t.tenantId, t.tareaRaizId),
    index('uso_modelo_tenant_puesto_creado_idx').on(t.tenantId, t.puestoId, t.creadoEn.desc()),
  ],
);
