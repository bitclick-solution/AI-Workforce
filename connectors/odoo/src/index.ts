/**
 * @aiw/connector-odoo
 *
 * Conector de Odoo sobre el MCP dinámico existente, con la licencia revisada y documentada.
 * Las herramientas (facturas vencidas, nota de seguimiento) llegan con la rebanada "Conector Odoo v0".
 * Las credenciales viven cifradas por tenant en el gateway MCP, nunca aquí.
 */
export const CONECTOR = {
  nombre: '@aiw/connector-odoo',
  tipo: 'conector',
  protocolo: 'mcp',
  responsabilidad: 'Conector de Odoo sobre el MCP dinámico existente.',
} as const;
