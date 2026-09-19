/**
 * @aiw/metrics
 *
 * Definiciones de indicadores por plantilla de departamento, materialización por hora y umbrales.
 * Sin almacén de datos aparte.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/metrics',
  tipo: 'paquete',
  responsabilidad:
    'Definiciones de indicadores por plantilla de departamento, materialización por hora y umbrales.',
} as const;

export type Paquete = typeof PAQUETE;
