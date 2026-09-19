VIGENTE

# Conector Odoo

Conector MCP de Odoo sobre el MCP dinámico ya existente en Bitclick. Es el primer conector del plan porque la instancia de Odoo está en casa, sin coste de licencia, y sirve de dogfooding.

- Rebanada que lo implementa: "Conector Odoo v0: facturas vencidas y nota de seguimiento sobre el MCP dinámico existente".
- Requisito previo: revisar y documentar aquí la licencia del MCP dinámico antes de importarlo.
- Las credenciales de Odoo se cifran por tenant y las inyecta el gateway MCP. Nunca aparecen en este paquete ni en el contexto del modelo.
