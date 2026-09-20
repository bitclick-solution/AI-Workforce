/**
 * @aiw/db
 *
 * Esquema de datos de AI Workforce. Zona crítica: migración de datos.
 *
 * PostgreSQL es la única fuente de verdad (ADR-002 y ADR-007). Este paquete declara
 * las tablas con Drizzle; la migración `drizzle/0000_inicial.sql` añade lo que Drizzle
 * no expresa: RLS y sus políticas, particionado por mes, roles, permisos, pgvector,
 * índices HNSW y la prohibición de actualizar el libro de auditoría.
 *
 * Depende de `@aiw/domain` para las enumeraciones y los esquemas Zod, y de nada más
 * del monorepo. Lo declarado aquí lo consumen `@aiw/ledger` y las aplicaciones.
 */
export const PAQUETE = {
  nombre: '@aiw/db',
  tipo: 'paquete',
  responsabilidad:
    'Esquema de PostgreSQL con Drizzle, migraciones versionadas, cliente con tenant y utilidades de carga, exportación y purga.',
} as const;

export type Paquete = typeof PAQUETE;

export * from './columnas.js';
export * from './enumeraciones.js';
export * from './organizacion.js';
export * from './equipo.js';
export * from './trabajo.js';
export * from './aprendizaje.js';
export * from './salas.js';
export * from './operaciones.js';
export * from './conectores.js';
export * from './conocimiento.js';
export * from './observacion.js';
export * from './cliente.js';
export * from './migrador.js';
export * from './identificadores.js';
export * from './tablas.js';
export * from './mantenimiento.js';
export * from './carga.js';
