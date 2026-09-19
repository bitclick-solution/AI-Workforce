import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as ledger } from '@aiw/ledger';
import { PAQUETE as mcp_gateway } from '@aiw/mcp-gateway';

/**
 * @aiw/api
 *
 * API TypeScript: organizaciones, departamentos, puestos, versiones, políticas, contador, auditoría y servidor MCP hacia fuera.
 *
 * Esta rebanada solo fija la frontera de la aplicación. Sin lógica de negocio todavía.
 */
export const APLICACION = {
  nombre: '@aiw/api',
  tipo: 'aplicacion',
  responsabilidad:
    'API TypeScript: organizaciones, departamentos, puestos, versiones, políticas, contador, auditoría y servidor MCP hacia fuera.',
  dependeDe: [domain.nombre, ledger.nombre, mcp_gateway.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
