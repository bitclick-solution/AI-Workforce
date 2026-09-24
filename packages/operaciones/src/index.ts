/**
 * @aiw/operaciones
 *
 * Propuestas de operación de organización del ADR-006 y catálogo de plantillas de
 * puesto como dato versionado. Puro: sin E/S. Lo usan el Director de IA, que vive en
 * `apps/platform-agents`, y los flujos del trabajador que ejecutan las propuestas.
 *
 * Está en un paquete y no en la aplicación porque dos aplicaciones lo necesitan, y
 * `apps/*` importan `packages/*`, nunca otra aplicación (CLAUDE.md, fronteras).
 */
export const PAQUETE = {
  nombre: '@aiw/operaciones',
  tipo: 'paquete',
  responsabilidad:
    'Propuestas de operación de organización (ADR-006) y catálogo de plantillas de puesto como dato.',
} as const;

export type Paquete = typeof PAQUETE;

// Sala v0: contratar desde una frase
export * from './director.js';
export * from './evals.js';
