/**
 * Indicadores, notificaciones y salida transaccional de eventos.
 *
 * El indicador es una definición: fórmula, fuentes, umbrales y ámbito. Un flujo lo
 * materializa cada hora en `indicador_valor` desde el libro de auditoría y los conectores.
 * `evento_salida` recibe en la misma transacción que el cambio lo que va a la sala,
 * al aprendizaje y al tablero; un proceso aparte lo publica.
 */
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { columnasInmutables, columnasMutables, idPrimario, tenantId } from './columnas.js';
import {
  ambito,
  canalNotificacion,
  estadoEventoSalida,
  estadoNotificacion,
} from './enumeraciones.js';
import { organizacion, persona } from './organizacion.js';

export const indicador = pgTable(
  'indicador',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    clave: text('clave').notNull(),
    definicion: jsonb('definicion').notNull().default({}),
    formula: text('formula').notNull(),
    fuentes: jsonb('fuentes').notNull().default([]),
    umbrales: jsonb('umbrales').notNull().default({}),
    ambito: ambito('ambito').notNull().default('organizacion'),
    ambitoId: uuid('ambito_id'),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('indicador_tenant_clave_key').on(t.tenantId, t.clave),
    index('indicador_tenant_ambito_idx').on(t.tenantId, t.ambito, t.ambitoId),
  ],
);

export const indicadorValor = pgTable(
  'indicador_valor',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    indicadorId: uuid('indicador_id')
      .notNull()
      .references(() => indicador.id, { onDelete: 'restrict' }),
    periodo: timestamp('periodo', { withTimezone: true }).notNull(),
    valor: numeric('valor', { precision: 18, scale: 6 }).notNull(),
    detalle: jsonb('detalle').notNull().default({}),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('indicador_valor_key').on(t.tenantId, t.indicadorId, t.periodo),
    index('indicador_valor_tenant_periodo_idx').on(t.tenantId, t.periodo),
  ],
);

export const notificacion = pgTable(
  'notificacion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    destinatarioPersonaId: uuid('destinatario_persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'restrict' }),
    suplentePersonaId: uuid('suplente_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    canal: canalNotificacion('canal').notNull(),
    motivo: text('motivo').notNull(),
    /** Entidad referenciada por tipo e identificador, nunca por clave foránea. */
    entidadTipo: text('entidad_tipo').notNull(),
    entidadId: uuid('entidad_id').notNull(),
    estado: estadoNotificacion('estado').notNull().default('pendiente'),
    venceEn: timestamp('vence_en', { withTimezone: true }),
    /** Identificador del lote: las notificaciones se agrupan antes de salir. */
    loteId: uuid('lote_id'),
    ...columnasMutables(),
  },
  (t) => [
    index('notificacion_tenant_destinatario_estado_idx').on(
      t.tenantId,
      t.destinatarioPersonaId,
      t.estado,
      t.creadoEn,
    ),
    index('notificacion_tenant_vence_idx').on(t.tenantId, t.venceEn),
  ],
);

export const eventoSalida = pgTable(
  'evento_salida',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tipo: text('tipo').notNull(),
    destino: text('destino').notNull(),
    carga: jsonb('carga').notNull().default({}),
    estado: estadoEventoSalida('estado').notNull().default('pendiente'),
    intentos: integer('intentos').notNull().default(0),
    ultimoError: text('ultimo_error'),
    publicadoEn: timestamp('publicado_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    index('evento_salida_tenant_estado_creado_idx').on(t.tenantId, t.estado, t.creadoEn),
    index('evento_salida_pendientes_idx').on(t.estado, t.creadoEn),
  ],
);
