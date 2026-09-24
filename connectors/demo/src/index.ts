/**
 * @aiw/connector-demo
 *
 * Servidor MCP de demostración con las dos herramientas de cobros del conector de
 * Odoo —`listar_facturas_vencidas` y `crear_nota_seguimiento`— sobre datos falsos
 * y con un fallo inyectable.
 *
 * Existe para que la prueba técnica del stack y la integración continua no dependan
 * del acceso a Odoo. Cuando «Conector Odoo v0» exista, el gateway registra el otro
 * servidor y ni el bucle del agente ni las políticas cambian: esa independencia es
 * parte de lo que se está demostrando (ADR-001, plano de control agnóstico del ERP).
 */
export const PAQUETE = {
  nombre: '@aiw/connector-demo',
  tipo: 'conector',
  responsabilidad:
    'Servidor MCP de demostración con las dos herramientas de cobros sobre datos de prueba y fallo inyectable.',
} as const;

export type Paquete = typeof PAQUETE;

export * from './datos.js';
export * from './servidor.js';
export * from './errores.js';
export * from './en-memoria.js';
export * from './http.js';
