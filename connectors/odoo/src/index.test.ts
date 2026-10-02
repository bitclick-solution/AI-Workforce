import { describe, expect, it } from 'vitest';

import { CONECTOR, CATALOGO, MOTIVOS, NOMBRES, NOMBRES_CONCILIACION } from './index.js';

describe('@aiw/connector-odoo', () => {
  it('se declara como conector MCP', () => {
    expect(CONECTOR.protocolo).toBe('mcp');
  });

  it('expone exactamente las dos herramientas de cobros y las dos de conciliación', () => {
    expect(CATALOGO.map((herramienta) => herramienta.name)).toEqual([
      NOMBRES.listar,
      NOMBRES.nota,
      NOMBRES_CONCILIACION.extracto,
      NOMBRES_CONCILIACION.asiento,
    ]);
  });

  it('publica los cuatro motivos de error del contrato', () => {
    expect(MOTIVOS).toHaveLength(4);
  });
});
