import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as operaciones } from '@aiw/operaciones';
import { PAQUETE as rooms } from '@aiw/rooms';

/**
 * @aiw/platform-agents
 *
 * Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.
 *
 * Sala v0: el moderador puro vive en `@aiw/rooms` y el Director puro, con su
 * catálogo de plantillas, en `@aiw/operaciones`. Los dos se ejecutan como
 * actividades del trabajador hasta que tengan paso de modelo y este proceso tenga su
 * propia cola (docs/specs/sala-v0.md, decisión 1).
 */
export const APLICACION = {
  nombre: '@aiw/platform-agents',
  tipo: 'aplicacion',
  responsabilidad:
    'Agentes de plataforma: moderador de sala, supervisor de departamento y Director de IA.',
  dependeDe: [domain.nombre, rooms.nombre, operaciones.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
