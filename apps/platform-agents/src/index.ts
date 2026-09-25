import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as rooms } from '@aiw/rooms';

/**
 * @aiw/platform-agents
 *
 * Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.
 *
 * Sala v0: el Director de IA puro y su catálogo de plantillas como dato. El
 * moderador vive en `@aiw/rooms`, que es donde el ADR-004 pone la moderación. Los
 * dos se ejecutan como actividades del trabajador hasta que tengan paso de modelo
 * (docs/specs/sala-v0.md, decisión 1).
 */
export const APLICACION = {
  nombre: '@aiw/platform-agents',
  tipo: 'aplicacion',
  responsabilidad:
    'Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.',
  dependeDe: [domain.nombre, rooms.nombre],
} as const;

export type Aplicacion = typeof APLICACION;

// Sala v0
export * from './director.js';
