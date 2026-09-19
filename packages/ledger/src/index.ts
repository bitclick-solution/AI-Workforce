/**
 * @aiw/ledger
 *
 * Libro de auditoría append-only con hash encadenado y contador de tareas.
 * Zona crítica: libro de auditoría y contador. Un único punto de escritura.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/ledger',
  tipo: 'paquete',
  responsabilidad: 'Libro de auditoría append-only con hash encadenado y contador de tareas.',
} as const;

export type Paquete = typeof PAQUETE;
