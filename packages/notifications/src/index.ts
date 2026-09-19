/**
 * @aiw/notifications
 *
 * Bandeja humana, preferencias por canal, plazos y suplencias.
 * Nada que necesite a una persona se pierde.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/notifications',
  tipo: 'paquete',
  responsabilidad: 'Bandeja humana, preferencias por canal, plazos y suplencias.',
} as const;

export type Paquete = typeof PAQUETE;
