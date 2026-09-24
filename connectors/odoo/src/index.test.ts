import { describe, expect, it } from 'vitest';

import { CONECTOR, CATALOGO, MOTIVOS, NOMBRES } from './index.js';

describe('@aiw/connector-odoo', () => {
  it('se declara como conector MCP', () => {
    expect(CONECTOR.protocolo).toBe('mcp');
  });

  it('expone exactamente las dos herramientas de la rebanada', () => {
    expect(CATALOGO.map((herramienta) => herramienta.name)).toEqual([NOMBRES.listar, NOMBRES.nota]);
  });

  it('publica los cuatro motivos de error del contrato', () => {
    expect(MOTIVOS).toHaveLength(4);
  });
});
