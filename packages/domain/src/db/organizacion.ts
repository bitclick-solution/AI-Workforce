/**
 * Raíces de tenant y personas.
 *
 * `organizacion.id` es el `tenant_id` de todo el modelo: el resto de tablas lo
 * referencian con borrado restringido. `organizacion_paraguas` es la única tabla
 * que cruza organizaciones y su política de RLS solo deja ver el paraguas al que
 * pertenece el tenant de la sesión.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { columnasMutables, idPrimario, tenantId } from './columnas.js';
import { estadoOrganizacion, planOrganizacion } from './enumeraciones.js';

/** Partner con organizaciones cliente, permisos cruzados y facturación por cliente. */
export const organizacionParaguas = pgTable(
  'organizacion_paraguas',
  {
    id: idPrimario(),
    nombre: text('nombre').notNull(),
    identificacionFiscal: text('identificacion_fiscal'),
    facturacion: jsonb('facturacion').notNull().default({}),
    plantillasCompartibles: jsonb('plantillas_compartibles').notNull().default([]),
    ...columnasMutables(),
  },
  (t) => [index('organizacion_paraguas_nombre_idx').on(t.nombre)],
);

/** Raíz del tenant. Su identificador es el `tenant_id` de todas las demás tablas. */
export const organizacion = pgTable(
  'organizacion',
  {
    id: idPrimario(),
    paraguasId: uuid('paraguas_id').references(() => organizacionParaguas.id, {
      onDelete: 'restrict',
    }),
    nombre: text('nombre').notNull(),
    plan: planOrganizacion('plan').notNull().default('starter'),
    regionDatos: text('region_datos').notNull().default('eu-west'),
    limites: jsonb('limites').notNull().default({}),
    /** Mínimo legal de seis meses; la retención se cumple soltando particiones. */
    retencionMeses: bigint('retencion_meses', { mode: 'number' }).notNull().default(6),
    politicaCruceDepartamentos: jsonb('politica_cruce_departamentos').notNull().default({}),
    brandVoice: jsonb('brand_voice').notNull().default({}),
    estado: estadoOrganizacion('estado').notNull().default('activa'),
    ...columnasMutables(),
  },
  (t) => [
    index('organizacion_paraguas_idx').on(t.paraguasId, t.creadoEn),
    index('organizacion_estado_idx').on(t.estado, t.creadoEn),
  ],
);

/**
 * Persona del tenant: aprueba, recibe notificaciones y supervisa departamentos.
 * La identidad completa (Better Auth, SSO, SCIM) llega en su propia rebanada;
 * aquí solo existe lo que necesitan las claves foráneas del modelo.
 */
export const persona = pgTable(
  'persona',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    nombre: text('nombre').notNull(),
    correo: text('correo').notNull(),
    telefono: text('telefono'),
    activa: boolean('activa').notNull().default(true),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('persona_tenant_correo_key').on(t.tenantId, t.correo),
    index('persona_tenant_activa_idx').on(t.tenantId, t.activa, t.creadoEn),
  ],
);

/** Tareas prepagadas que se consumen tras el cupo del plan. Sin sobrecoste automático. */
export const paqueteTareas = pgTable(
  'paquete_tareas',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tareasCompradas: bigint('tareas_compradas', { mode: 'number' }).notNull(),
    tareasConsumidas: bigint('tareas_consumidas', { mode: 'number' }).notNull().default(0),
    precioEuros: numeric('precio_euros', { precision: 12, scale: 4 }).notNull().default('0'),
    caducaEn: timestamp('caduca_en', { withTimezone: true }).notNull(),
    ...columnasMutables(),
  },
  (t) => [index('paquete_tareas_tenant_caduca_idx').on(t.tenantId, t.caducaEn)],
);

/** Registro de migraciones aplicadas. Tabla de infraestructura: sin tenant y sin RLS. */
export const migracionAplicada = pgTable('migracion_aplicada', {
  nombre: text('nombre').primaryKey(),
  huella: text('huella').notNull(),
  aplicadaEn: timestamp('aplicada_en', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
