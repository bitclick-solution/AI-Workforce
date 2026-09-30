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
  check,
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
import { estadoOrganizacion } from './enumeraciones.js';

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
    /**
     * Plan comercial. Columna `text` validada por `esquemas.planOrganizacion` de
     * `@aiw/domain`: el ADR-011 marca los planes como hipótesis que se revisa al
     * cierre de la fase 1, y cambiar la lista no puede costar una migración.
     */
    plan: text('plan').notNull().default('departamento'),
    regionDatos: text('region_datos').notNull().default('eu-west'),
    limites: jsonb('limites').notNull().default({}),
    /**
     * Retención de la auditoría en meses (ADR-010): mínimo 6, por defecto 24 y
     * máximo 120. La retención se cumple soltando particiones, nunca borrando filas.
     */
    retencionMeses: bigint('retencion_meses', { mode: 'number' }).notNull().default(24),
    politicaCruceDepartamentos: jsonb('politica_cruce_departamentos').notNull().default({}),
    brandVoice: jsonb('brand_voice').notNull().default({}),
    estado: estadoOrganizacion('estado').notNull().default('activa'),
    ...columnasMutables(),
  },
  (t) => [
    index('organizacion_paraguas_idx').on(t.paraguasId, t.creadoEn),
    index('organizacion_estado_idx').on(t.estado, t.creadoEn),
    check('organizacion_retencion_rango', sql`${t.retencionMeses} between 6 and 120`),
  ],
);

/**
 * Persona del tenant: aprueba, recibe notificaciones y supervisa departamentos.
 * Quien entra al panel es un `usuario` de `identidad.ts` enlazado a una persona;
 * SSO y SCIM llegan en su propia rebanada. Aquí solo existe lo que necesitan las
 * claves foráneas del modelo.
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
    /**
     * Privacidad de la presencia en las salas (ADR-026): visible por defecto, cada
     * persona puede apagarla desde su perfil. Vive en `persona` y no en `usuario`
     * (identidad de Better Auth) porque la presencia de Sala v1 se calcula con el
     * rol de aplicación, que no tiene permiso sobre las tablas de identidad.
     */
    mostrarPresencia: boolean('mostrar_presencia').notNull().default(true),
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
