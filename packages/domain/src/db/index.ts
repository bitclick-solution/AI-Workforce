/**
 * Esquema de datos de AI Workforce.
 *
 * PostgreSQL es la única fuente de verdad (ADR-002 y ADR-007). Este módulo declara
 * las tablas con Drizzle; la migración `drizzle/0000_inicial.sql` añade lo que Drizzle
 * no expresa: RLS y sus políticas, particionado por mes, roles, permisos, pgvector,
 * índices HNSW y la prohibición de actualizar el libro de auditoría.
 *
 * `packages/domain` no depende de ningún otro paquete del monorepo.
 */
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
