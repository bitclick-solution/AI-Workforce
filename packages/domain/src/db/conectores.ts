/**
 * Conector y autorización de herramientas.
 *
 * Puesto N:M Conector a través de `autorizacion_herramientas`, que guarda la lista
 * blanca y el nivel por clase de acción. Las credenciales se guardan cifradas y
 * nunca entran en el contexto del modelo: solo el gateway MCP las descifra.
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { columnasMutables, idPrimario, tenantId } from './columnas.js';
import { estadoConector, tipoConector } from './enumeraciones.js';
import { puesto } from './equipo.js';
import { organizacion, persona } from './organizacion.js';

export const conector = pgTable(
  'conector',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tipo: tipoConector('tipo').notNull(),
    nombre: text('nombre').notNull(),
    /** Sobre cerrado: texto cifrado con la clave del tenant. Nunca va al modelo. */
    credencialesCifradas: text('credenciales_cifradas'),
    referenciaSecreto: text('referencia_secreto'),
    herramientasDescubiertas: jsonb('herramientas_descubiertas').notNull().default([]),
    estado: estadoConector('estado').notNull().default('configurado'),
    ultimaSincronizacion: timestamp('ultima_sincronizacion', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('conector_tenant_nombre_key').on(t.tenantId, t.nombre),
    index('conector_tenant_estado_idx').on(t.tenantId, t.estado, t.creadoEn),
  ],
);

export const autorizacionHerramientas = pgTable(
  'autorizacion_herramientas',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id')
      .notNull()
      .references(() => puesto.id, { onDelete: 'restrict' }),
    conectorId: uuid('conector_id')
      .notNull()
      .references(() => conector.id, { onDelete: 'restrict' }),
    /** Lista blanca de herramientas del conector para este puesto. */
    listaBlanca: jsonb('lista_blanca').notNull().default([]),
    /** Nivel N0 a N3 por clase de acción. Validado con Zod antes de escribir. */
    nivelesPorClase: jsonb('niveles_por_clase').notNull().default({}),
    concedidaPorPersonaId: uuid('concedida_por_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    revocadaEn: timestamp('revocada_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('autorizacion_herramientas_key').on(t.tenantId, t.puestoId, t.conectorId),
    index('autorizacion_herramientas_tenant_conector_idx').on(t.tenantId, t.conectorId),
  ],
);
