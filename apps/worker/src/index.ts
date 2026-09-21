import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as models } from '@aiw/models';
import { PAQUETE as learning } from '@aiw/learning';
import { PAQUETE as gateway } from '@aiw/mcp-gateway';

/**
 * @aiw/worker
 *
 * Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.
 *
 * Dos mitades con reglas distintas. `src/flujos` es determinista y se compila
 * aislado: se puede volver a ejecutar desde el historial de Temporal y da siempre
 * lo mismo. `src/actividades` es donde viven los efectos: base de datos, gateway
 * MCP, proveedores de modelo. `src/bucle` es el bucle del agente, código propio
 * sobre las primitivas del AI SDK, sin efectos y sin framework de agentes.
 *
 * Todo detrás de `AIW_PRUEBA_STACK`. Con la bandera apagada el proceso imprime qué
 * le falta y termina limpio.
 */
export const APLICACION = {
  nombre: '@aiw/worker',
  tipo: 'aplicacion',
  responsabilidad:
    'Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.',
  dependeDe: [domain.nombre, models.nombre, learning.nombre, gateway.nombre],
} as const;

export type Aplicacion = typeof APLICACION;

export * from './configuracion.js';
export * from './bucle/tipos.js';
export * from './bucle/guardias.js';
export * from './bucle/bucle.js';
export * from './actividades/contexto.js';
export * from './actividades/index.js';
export * from './semilla.js';
export * from './trabajador.js';
