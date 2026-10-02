/**
 * Esquemas de entrada de las herramientas del MCP dinámico que este conector
 * llama (no las que expone: ver `esquemas.ts` para esas).
 *
 * Tres derivas seguidas han nacido de una forma de llamada supuesta en vez de
 * comprobada contra la v1.3.1 real: la envolvente de lectura (`records` en vez
 * de `result`), la envolvente de aprobación de escritura (sin explorar
 * `result`) y el nombre del argumento de `chatter_post` (`res_id` en vez de
 * `record_id`). Esquemas aquí, en un solo sitio, y una prueba de conformidad
 * en `conformidad.test.ts` que valida cada llamada real del conector contra
 * ellos: la próxima deriva falla en local, no cuatro intentos después contra
 * el ERP real.
 *
 * Mientras la rebanada no traiga una sección «Esquemas vivos del MCP de Odoo
 * v1.3.1» con lo que el Probador sacó de `tools/list` contra el MCP real,
 * estos esquemas se sacan de las firmas de las herramientas anotadas con
 * `@mcp.tool()` en el código fuente de erpipe-org/mcp-odoo (MIT, leído sin
 * copiarlo, igual que el resto del README de este conector):
 * `src/odoo_mcp/tools_read.py` (`search_records`) y
 * `src/odoo_mcp/tools_write.py` (`chatter_post`, `preview_write`,
 * `validate_write`, `execute_approved_write_tool`).
 */
import { z } from 'zod';

/** `search_records(model, domain=None, fields=None, limit=10, offset=0, order=None, query=None, instance=None)`. */
export const EsquemaBuscarRegistros = z.strictObject({
  model: z.string(),
  domain: z.unknown().optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  order: z.string().optional(),
  query: z.string().optional(),
  instance: z.string().optional(),
});

/**
 * `chatter_post(model, record_id, body, message_type="comment", subtype_xmlid=None,
 * partner_ids=None, attachment_ids=None, approval=None, confirm=False, instance=None)`.
 * `model`, `record_id` y `body` son obligatorios; `record_id` es entero, no la
 * clave `res_id` de un campo relacional de Odoo (esa sí vale dentro de
 * `values` en una escritura por `preview_write`/`validate_write`).
 */
export const EsquemaNotaEnHistorial = z.strictObject({
  model: z.string(),
  record_id: z.number().int(),
  body: z.string(),
  message_type: z.string().optional(),
  subtype_xmlid: z.string().optional(),
  partner_ids: z.array(z.number().int()).optional(),
  attachment_ids: z.array(z.number().int()).optional(),
  approval: z.record(z.string(), z.unknown()).optional(),
  confirm: z.boolean().optional(),
  instance: z.string().optional(),
});

/** `preview_write(model, operation, values=None, values_list=None, record_ids=None, context=None, instance=None)`. */
export const EsquemaPrepararEscritura = z.strictObject({
  model: z.string(),
  operation: z.string(),
  values: z.record(z.string(), z.unknown()).optional(),
  values_list: z.array(z.record(z.string(), z.unknown())).optional(),
  record_ids: z.array(z.number().int()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  instance: z.string().optional(),
});

/** `validate_write(model, operation, values=None, values_list=None, record_ids=None, context=None, fields_metadata=None, use_live_metadata=True, instance=None)`. */
export const EsquemaValidarEscritura = EsquemaPrepararEscritura.extend({
  fields_metadata: z.record(z.string(), z.unknown()).optional(),
  use_live_metadata: z.boolean().optional(),
});

/**
 * `execute_approved_write_tool(approval, confirm=False)`. `approval` es
 * obligatorio y es el objeto entero que devolvió `validate_write` bajo
 * `result.approval` (con su `token` dentro) — no un `approval_id` ni un
 * `token` sueltos: ese campo no existe en la herramienta real.
 */
export const EsquemaEjecutarEscritura = z.strictObject({
  approval: z.record(z.string(), z.unknown()),
  confirm: z.boolean().optional(),
});

/** Una entrada por cada herramienta dinámica que el conector llama (`cliente.ts`). */
export const ESQUEMAS_MCP_DINAMICO = {
  search_records: EsquemaBuscarRegistros,
  chatter_post: EsquemaNotaEnHistorial,
  preview_write: EsquemaPrepararEscritura,
  validate_write: EsquemaValidarEscritura,
  execute_approved_write: EsquemaEjecutarEscritura,
} as const;
