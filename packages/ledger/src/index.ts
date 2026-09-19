/**
 * @aiw/ledger
 *
 * Libro de auditoría append-only con hash encadenado y contador de tareas.
 * Zona crítica: libro de auditoría y contador. Un único punto de escritura, `anotar`.
 *
 * El esquema vive en `./db/esquema.ts`; su DDL entra en la migración inicial de
 * `@aiw/domain`, que es la única migración de la base.
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
