/**
 * @aiw/learning
 *
 * Señales, lecciones candidatas, evaluación en sombra, promoción por nivel y versiones de puesto.
 * Zona crítica: promociones del aprendizaje.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/learning',
  tipo: 'paquete',
  responsabilidad:
    'Señales, lecciones candidatas, evaluación en sombra, promoción por nivel y versiones de puesto.',
} as const;

export type Paquete = typeof PAQUETE;
