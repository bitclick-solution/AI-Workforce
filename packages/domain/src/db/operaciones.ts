/**
 * Propuesta de operación: única vía para cambiar la organización.
 *
 * Se ejecuta como flujo idempotente según su nivel y queda en el registro aunque
 * se rechace. Las entidades tocadas se referencian por identificador dentro de
 * `entidades_tocadas` para que la propuesta sobreviva a purgas y archivados.
 */
import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { columnasMutables, idPrimario, tenantId } from './columnas.js';
import { estadoPropuesta, nivelAutonomia, tipoActor, tipoOperacion } from './enumeraciones.js';
import { puesto } from './equipo.js';
import { organizacion, persona } from './organizacion.js';

export const propuestaOperacion = pgTable(
  'propuesta_operacion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tipo: tipoOperacion('tipo').notNull(),
    actorTipo: tipoActor('actor_tipo').notNull(),
    actorPersonaId: uuid('actor_persona_id').references(() => persona.id, { onDelete: 'restrict' }),
    actorPuestoId: uuid('actor_puesto_id').references(() => puesto.id, { onDelete: 'restrict' }),
    resumen: text('resumen').notNull(),
    entidadesTocadas: jsonb('entidades_tocadas').notNull().default([]),
    efectosPrevistos: jsonb('efectos_previstos').notNull().default({}),
    costeEstimadoEuros: numeric('coste_estimado_euros', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    evidencia: jsonb('evidencia').notNull().default({}),
    nivelExigido: nivelAutonomia('nivel_exigido').notNull().default('n0'),
    estado: estadoPropuesta('estado').notNull().default('borrador'),
    decididaPorPersonaId: uuid('decidida_por_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    motivoDecision: text('motivo_decision'),
    formaReversion: jsonb('forma_reversion').notNull().default({}),
    ejecutadaEn: timestamp('ejecutada_en', { withTimezone: true }),
    revertidaEn: timestamp('revertida_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    index('propuesta_operacion_tenant_estado_idx').on(t.tenantId, t.estado, t.creadoEn),
    index('propuesta_operacion_tenant_tipo_idx').on(t.tenantId, t.tipo, t.creadoEn),
  ],
);
