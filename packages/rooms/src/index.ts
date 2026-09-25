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
