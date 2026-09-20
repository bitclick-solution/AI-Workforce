/**
 * Conocimiento y memoria.
 *
 * El índice es de la plataforma, los documentos no: el fragmento guarda texto,
 * embedding, fuente, ámbito, control de acceso heredado y frescura, y se borra al
 * borrarse el origen. La memoria tiene ámbito (organización, departamento, puesto),
 * caducidad y marca de categoría especial; lo que cruza de ámbito lo decide la política.
 *
 * pgvector no admite índices HNSW multicolumna: el aislamiento por tenant lo garantiza
 * la RLS y el índice compuesto `(tenant_id, ambito, ambito_id)` que acompaña al HNSW.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

import {
  DIMENSION_EMBEDDING,
  columnasInmutables,
  columnasMutables,
  idPrimario,
  tenantId,
} from './columnas.js';
import { ambito } from './enumeraciones.js';
import { organizacion, persona } from './organizacion.js';

export const documentoCanonico = pgTable(
  'documento_canonico',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    titulo: text('titulo').notNull(),
    contenido: text('contenido').notNull(),
    version: integer('version').notNull().default(1),
    propietarioPersonaId: uuid('propietario_persona_id').references(() => persona.id, {
      onDelete: 'restrict',
    }),
    ambito: ambito('ambito').notNull().default('organizacion'),
    ambitoId: uuid('ambito_id'),
    /** Prevalece sobre cualquier fragmento indexado. Cambiarlo es una propuesta de operación. */
    vigente: boolean('vigente').notNull().default(true),
    revisadoEn: timestamp('revisado_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('documento_canonico_tenant_titulo_version_key').on(t.tenantId, t.titulo, t.version),
    index('documento_canonico_tenant_vigente_idx').on(t.tenantId, t.vigente, t.ambito),
  ],
);

export const fragmentoConocimiento = pgTable(
  'fragmento_conocimiento',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    ambito: ambito('ambito').notNull().default('organizacion'),
    ambitoId: uuid('ambito_id'),
    fuente: text('fuente').notNull(),
    /** Identificador del documento de origen: si se borra el origen, se borra el fragmento. */
    documentoOrigenId: uuid('documento_origen_id'),
    versionDocumento: integer('version_documento').notNull().default(1),
    texto: text('texto').notNull(),
    embedding: vector('embedding', { dimensions: DIMENSION_EMBEDDING }),
    controlAcceso: jsonb('control_acceso').notNull().default({}),
    frescura: timestamp('frescura', { withTimezone: true }),
    /** Un fragmento nunca contiene categorías especiales; la marca permite auditarlo. */
    categoriaEspecial: boolean('categoria_especial').notNull().default(false),
    ...columnasMutables(),
  },
  (t) => [
    index('fragmento_conocimiento_tenant_ambito_idx').on(t.tenantId, t.ambito, t.ambitoId),
    index('fragmento_conocimiento_tenant_origen_idx').on(t.tenantId, t.documentoOrigenId),
  ],
);

export const memoria = pgTable(
  'memoria',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    ambito: ambito('ambito').notNull(),
    /** Identificador del departamento o del puesto dueño; nulo si el ámbito es la organización. */
    ambitoId: uuid('ambito_id'),
    clave: text('clave').notNull(),
    contenido: text('contenido').notNull(),
    embedding: vector('embedding', { dimensions: DIMENSION_EMBEDDING }),
    metadatos: jsonb('metadatos').notNull().default({}),
    categoriaEspecial: boolean('categoria_especial').notNull().default(false),
    caducaEn: timestamp('caduca_en', { withTimezone: true }),
    ...columnasMutables(),
  },
  (t) => [
    index('memoria_tenant_ambito_idx').on(t.tenantId, t.ambito, t.ambitoId),
    index('memoria_tenant_caduca_idx').on(t.tenantId, t.caducaEn),
  ],
);

/** Grafo ligero: cliente, proveedor, producto, contacto, con identificadores por sistema. */
export const entidad = pgTable(
  'entidad',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    tipo: text('tipo').notNull(),
    nombre: text('nombre').notNull(),
    /** Identificadores en cada sistema: `{ "odoo": "res.partner/42", "factusol": "CLI/17" }`. */
    identificadores: jsonb('identificadores').notNull().default({}),
    ...columnasMutables(),
  },
  (t) => [
    index('entidad_tenant_tipo_nombre_idx').on(t.tenantId, t.tipo, t.nombre),
    index('entidad_tenant_identificadores_idx').using('gin', t.identificadores),
  ],
);

export const relacion = pgTable(
  'relacion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    origenId: uuid('origen_id')
      .notNull()
      .references(() => entidad.id, { onDelete: 'restrict' }),
    destinoId: uuid('destino_id')
      .notNull()
      .references(() => entidad.id, { onDelete: 'restrict' }),
    tipo: text('tipo').notNull(),
    atributos: jsonb('atributos').notNull().default({}),
    ...columnasInmutables(),
  },
  (t) => [
    uniqueIndex('relacion_key').on(t.tenantId, t.origenId, t.destinoId, t.tipo),
    index('relacion_tenant_destino_idx').on(t.tenantId, t.destinoId),
  ],
);
