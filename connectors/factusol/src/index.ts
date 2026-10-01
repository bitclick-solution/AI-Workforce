/**
 * @aiw/connector-factusol
 *
 * Conector MCP de Factusol: facturas vencidas y nota de seguimiento sobre Factusol
 * MCP 3.4.7 (Python, producto propio) consumido como imagen aislada, según el
 * ADR-002. El mapeo está en `docs/specs/conector-factusol-v0.md`.
 *
 * Las credenciales llegan solo por entorno y no entran nunca en el contexto del
 * modelo. El token del agente no lleva el scope `confirmar`.
 */
export const CONECTOR = {
  nombre: '@aiw/connector-factusol',
  tipo: 'conector',
  protocolo: 'mcp',
  responsabilidad: 'Conector de Factusol sobre Factusol MCP.',
} as const;

export { clienteGrabado, clienteSse, leerRespuesta, HERRAMIENTAS_FACTUSOL } from './cliente.js';
export type { ClienteFactusol, Grabaciones, LlamadaGrabada } from './cliente.js';
export {
  OPERACION_CONFIRMAR,
  comprobarCoincidencia,
  confirmacionPorGateway,
  confirmacionPorPersona,
  leerOpcionDeConfirmacion,
} from './confirmacion.js';
export type { ConfirmadorDeBorrador } from './confirmacion.js';
export {
  almacenDeBorradoresEnFichero,
  almacenDeBorradoresEnMemoria,
} from './almacen-borradores.js';
export type { AlmacenDeBorradores } from './almacen-borradores.js';
export {
  LONGITUD_MINIMA_SECRETO,
  MOTIVO_SALTO,
  VARIABLES,
  hayCredenciales,
  leerConfiguracion,
  redactar,
  scopesDelToken,
} from './entorno.js';
export type { ConfiguracionFactusol } from './entorno.js';
export { CODIGO_POR_MOTIVO, ErrorConector, MOTIVOS, motivoDeMensaje } from './errores.js';
export type { Motivo } from './errores.js';
export * from './esquemas.js';
export { ESQUEMA_ENTRADA_LISTAR, ESQUEMA_ENTRADA_NOTA } from './esquema-json.js';
export { NOMBRES, almacenEnMemoria, crearHerramientas, sinVencimiento } from './herramientas.js';
export type { Herramientas, ResolutorDeVencimiento } from './herramientas.js';
export { esProcesoPrincipal } from './proceso.js';
export { CATALOGO, crearServidor, montarConector } from './servidor.js';
