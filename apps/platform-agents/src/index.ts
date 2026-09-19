import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as rooms } from '@aiw/rooms';

/**
 * @aiw/platform-agents
 *
 * Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.
 *
 * Esta rebanada solo fija la frontera de la aplicación. Sin lógica de negocio todavía.
 */
export const APLICACION = {
  nombre: '@aiw/platform-agents',
  tipo: 'aplicacion',
  responsabilidad:
    'Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.',
  dependeDe: [domain.nombre, rooms.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
