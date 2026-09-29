/**
 * @aiw/rooms
 *
 * Salas, moderación, menciones, acuerdos e intervenciones.
 * La verdad vive en Postgres; Centrifugo solo hace fan-out.
 *
 * Sala v0: el moderador puro y el vocabulario que comparten la API y el trabajador.
 * Sin E/S: quien lee y escribe la sala es el trabajador, dentro de sus actividades.
 */
export const PAQUETE = {
  nombre: '@aiw/rooms',
  tipo: 'paquete',
  responsabilidad: 'Salas, moderación, menciones, acuerdos e intervenciones.',
} as const;

export type Paquete = typeof PAQUETE;

// Sala v0
export * from './moderador.js';
export * from './sala.js';

// Sala v1: presencia en vivo (ADR-022)
export * from './presencia.js';

// `./centrifugo.js` no se reexporta aquí a propósito: usa `node:crypto`, y este
// índice lo importa el paquete de flujos de Temporal (`apps/worker/src/flujos`),
// que se empaqueta para un entorno aislado sin módulos nativos de Node. Quien
// necesite firmar tokens o llamar al API de Centrifugo —las actividades del
// trabajador y la API— importa `@aiw/rooms/centrifugo` directamente.
