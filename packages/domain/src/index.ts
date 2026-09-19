/**
 * @aiw/domain
 *
 * Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.
 * Zona crítica: identidad y permisos, motor de políticas y niveles.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/domain',
  tipo: 'paquete',
  responsabilidad:
    'Entidades, políticas, niveles de autonomía, brand voice, clase de riesgo y esquemas Zod compartidos.',
} as const;

export type Paquete = typeof PAQUETE;
