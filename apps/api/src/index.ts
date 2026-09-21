import { PAQUETE as db } from '@aiw/db';
import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as ledger } from '@aiw/ledger';
import { PAQUETE as mcp_gateway } from '@aiw/mcp-gateway';

/**
 * @aiw/api
 *
 * API TypeScript: organizaciones, departamentos, puestos, versiones, políticas, contador, auditoría y servidor MCP hacia fuera.
 *
 * Hoy sirve las tres rutas de lectura del contador de tareas v0, detrás de bandera;
 * el resto de la API llega con sus rebanadas.
 */
export const APLICACION = {
  nombre: '@aiw/api',
  tipo: 'aplicacion',
  responsabilidad:
    'API TypeScript: organizaciones, departamentos, puestos, versiones, políticas, contador, auditoría y servidor MCP hacia fuera.',
  dependeDe: [db.nombre, domain.nombre, ledger.nombre, mcp_gateway.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
