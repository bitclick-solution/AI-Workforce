/**
 * La sala es un canal más del motor: sala, participante, mensaje e intervención.
 *
 * `mensaje` está particionada por mes; su clave primaria incluye `creado_en` y las
 * demás tablas la referencian por identificador, nunca con clave foránea.
 * Cada intervención es una tarea ligera con su propio flujo.
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

import {
  columnasInmutables,
  columnasMutables,
  creadoEn,
  idParticionado,
  idPrimario,
  tenantId,
} from './columnas.js';
import { ambito, rolParticipante } from './enumeraciones.js';
import { departamento, puesto } from './equipo.js';
import { organizacion, persona } from './organizacion.js';
import { tarea } from './trabajo.js';

export const sala = pgTable(
  'sala',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    departamentoId: uuid('departamento_id').references(() => departamento.id, {
      onDelete: 'restrict',
    }),
    ambito: ambito('ambito').notNull().default('departamento'),
    nombre: text('nombre').notNull(),
    acuerdos: jsonb('acuerdos').notNull().default([]),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('sala_tenant_nombre_key').on(t.tenantId, t.nombre),
    index('sala_tenant_departamento_idx').on(t.tenantId, t.departamentoId),
  ],
);

export const salaParticipante = pgTable(
  'sala_participante',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    salaId: uuid('sala_id')
      .notNull()
      .references(() => sala.id, { onDelete: 'restrict' }),
    personaId: uuid('persona_id').references(() => persona.id, { onDelete: 'restrict' }),
    puestoId: uuid('puesto_id').references(() => puesto.id, { onDelete: 'restrict' }),
    rol: rolParticipante('rol').notNull(),
    /**
     * Hasta cuándo ha leído esta persona la sala (sala v1). Nulo: nunca ha leído,
     * todo lo que hay está sin leer. No aplica a un participante `puesto`: un
     * agente no tiene «sin leer». No es zona de auditoría: se sobrescribe en sitio.
     */
    ultimaLecturaEn: timestamp('ultima_lectura_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('sala_participante_persona_key').on(t.tenantId, t.salaId, t.personaId),
    uniqueIndex('sala_participante_puesto_key').on(t.tenantId, t.salaId, t.puestoId),
    index('sala_participante_tenant_sala_idx').on(t.tenantId, t.salaId, t.rol),
  ],
);

/** Particionada por mes. Cien mil mensajes por tenant es el volumen que se prueba. */
export const mensaje = pgTable(
  'mensaje',
  {
    id: idParticionado(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    salaId: uuid('sala_id')
      .notNull()
      .references(() => sala.id, { onDelete: 'restrict' }),
    hiloId: uuid('hilo_id'),
    autorPersonaId: uuid('autor_persona_id').references(() => persona.id, { onDelete: 'restrict' }),
    autorPuestoId: uuid('autor_puesto_id').references(() => puesto.id, { onDelete: 'restrict' }),
    cuerpo: text('cuerpo').notNull(),
    adjuntos: jsonb('adjuntos').notNull().default([]),
    creadoEn: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.creadoEn], name: 'mensaje_pkey' }),
    index('mensaje_tenant_sala_creado_idx').on(t.tenantId, t.salaId, t.creadoEn),
    index('mensaje_tenant_hilo_creado_idx').on(t.tenantId, t.hiloId, t.creadoEn),
  ],
);

/** Intervención N:1 Tarea. El mensaje se referencia por identificador. */
export const intervencion = pgTable(
  'intervencion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    salaId: uuid('sala_id')
      .notNull()
      .references(() => sala.id, { onDelete: 'restrict' }),
    mensajeId: uuid('mensaje_id').notNull(),
    mensajeCreadoEn: timestamp('mensaje_creado_en', { withTimezone: true }).notNull(),
    tareaId: uuid('tarea_id').references(() => tarea.id, { onDelete: 'restrict' }),
    moderadorPuestoId: uuid('moderador_puesto_id').references(() => puesto.id, {
      onDelete: 'restrict',
    }),
    motivo: text('motivo').notNull(),
    ...columnasInmutables(),
  },
  (t) => [
    index('intervencion_tenant_sala_creado_idx').on(t.tenantId, t.salaId, t.creadoEn),
    index('intervencion_tenant_mensaje_idx').on(t.tenantId, t.mensajeId),
  ],
);
