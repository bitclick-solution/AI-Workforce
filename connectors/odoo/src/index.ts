/**
 * @aiw/connector-odoo
 *
 * Conector MCP de Odoo: facturas vencidas y nota de seguimiento, sobre el MCP
 * dinámico existente (erpipe-org/mcp-odoo, licencia MIT, Python) consumido como
 * imagen de contenedor aislada, igual que Factusol y según el ADR-002. La
 * decisión y su motivo están en `docs/specs/conector-odoo-v0.md`.
 *
 * Las credenciales llegan solo por entorno, las inyecta el gateway MCP al
 * lanzar el proceso y no entran nunca en el contexto del modelo.
 */
export const CONECTOR = {
  nombre: '@aiw/connector-odoo',
  tipo: 'conector',
  protocolo: 'mcp',
  responsabilidad: 'Conector de Odoo sobre el MCP dinámico existente.',
} as const;

export { clienteGrabado, clienteHttp, leerCarga, HERRAMIENTAS_DINAMICAS } from './cliente.js';
export type { ClienteMcpDinamico, Grabaciones, LlamadaGrabada } from './cliente.js';
export {
  EXTREMO_MCP_POR_DEFECTO,
  MOTIVO_SALTO,
  VARIABLES,
  hayCredenciales,
  leerConfiguracion,
  redactar,
} from './entorno.js';
export type { ConfiguracionOdoo } from './entorno.js';
export { CODIGO_POR_MOTIVO, ErrorConector, MOTIVOS, motivoDeMensaje } from './errores.js';
export type { Motivo } from './errores.js';
export * from './esquemas.js';
export { ESQUEMA_ENTRADA_LISTAR, ESQUEMA_ENTRADA_NOTA } from './esquema-json.js';
export { NOMBRES, almacenEnMemoria, crearHerramientas, fechaDeCorte } from './herramientas.js';
export type { Herramientas } from './herramientas.js';
export { CATALOGO, crearServidor, montarConector } from './servidor.js';
