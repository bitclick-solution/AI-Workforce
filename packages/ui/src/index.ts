/**
 * @aiw/ui
 *
 * Componentes de interfaz compartidos entre el panel y la sala.
 * Sistema de diseño de Bitclick; shadcn/ui llega con la rebanada del Diseñador.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/ui',
  tipo: 'paquete',
  responsabilidad: 'Componentes de interfaz compartidos entre el panel y la sala.',
} as const;

export type Paquete = typeof PAQUETE;

export { cn } from './cn';
export { Estado } from './estado';
export type { EstadoProps } from './estado';
