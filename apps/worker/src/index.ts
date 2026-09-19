import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as models } from '@aiw/models';
import { PAQUETE as learning } from '@aiw/learning';

/**
 * @aiw/worker
 *
 * Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.
 *
 * Esta rebanada solo fija la frontera de la aplicación. Sin lógica de negocio todavía.
 */
export const APLICACION = {
  nombre: '@aiw/worker',
  tipo: 'aplicacion',
  responsabilidad:
    'Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.',
  dependeDe: [domain.nombre, models.nombre, learning.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
