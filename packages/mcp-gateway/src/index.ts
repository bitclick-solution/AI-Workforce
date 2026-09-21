/**
 * @aiw/mcp-gateway
 *
 * Cliente MCP, lista blanca por puesto y nivel, inyección de credenciales del tenant y registro de cada llamada.
 * Zona crítica: gateway MCP y credenciales. Las credenciales nunca entran en el contexto del modelo.
 *
 * La única puerta por la que un agente toca un sistema de fuera. Cuatro cosas pasan
 * aquí y en ningún otro sitio: la lista blanca del puesto, la segunda lectura de la
 * política con el estado actual del puesto, la resolución de la credencial por
 * `conector.referencia_secreto`, y la entrada en el libro de cada llamada, cada
 * rechazo y cada descubrimiento.
 */
export const PAQUETE = {
  nombre: '@aiw/mcp-gateway',
  tipo: 'paquete',
  responsabilidad:
    'Cliente MCP, lista blanca por puesto y nivel, inyección de credenciales del tenant y registro de cada llamada.',
} as const;

export type Paquete = typeof PAQUETE;

// Prueba técnica del stack
export * from './secretos.js';
export * from './herramientas.js';
export * from './cliente-mcp.js';
export * from './registro.js';
export * from './transportes.js';
export * from './autorizaciones.js';
export * from './gateway.js';
