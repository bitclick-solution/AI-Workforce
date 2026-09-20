/**
 * @aiw/ledger
 *
 * Libro de auditoría append-only con hash encadenado y contador de tareas.
 * Zona crítica: libro de auditoría y contador. Un único punto de escritura, `anotar`.
 *
 * El esquema vive en `./db/esquema.ts`; su DDL entra en la migración inicial de
 * `@aiw/db`, que es la única migración de la base.
 */
export const PAQUETE = {
  nombre: '@aiw/ledger',
  tipo: 'paquete',
  responsabilidad: 'Libro de auditoría append-only con hash encadenado y contador de tareas.',
} as const;

export type Paquete = typeof PAQUETE;

export * from './hash.js';
export * from './libro.js';
export * from './db/esquema.js';

// Contador de tareas v0
// Usos reales de modelo, tarifas versionadas, puntos de escritura del contador y
// consultas de lectura del panel. Todo lo que suma pasa por `anotar`.
export * from './contador-esquema.js';
export * from './contador.js';
export * from './contador-catalogo.js';
export * from './contador-consultas.js';
