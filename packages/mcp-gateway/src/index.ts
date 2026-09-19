/**
 * @aiw/mcp-gateway
 *
 * Cliente MCP, lista blanca por puesto y nivel, inyección de credenciales del tenant y registro de cada llamada.
 * Zona crítica: gateway MCP y credenciales. Las credenciales nunca entran en el contexto del modelo.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/mcp-gateway',
  tipo: 'paquete',
  responsabilidad:
    'Cliente MCP, lista blanca por puesto y nivel, inyección de credenciales del tenant y registro de cada llamada.',
} as const;

export type Paquete = typeof PAQUETE;
