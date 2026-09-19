/**
 * @aiw/rooms
 *
 * Salas, moderación, menciones, acuerdos e intervenciones.
 * La verdad vive en Postgres; Centrifugo solo hace fan-out.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/rooms',
  tipo: 'paquete',
  responsabilidad: 'Salas, moderación, menciones, acuerdos e intervenciones.',
} as const;

export type Paquete = typeof PAQUETE;
