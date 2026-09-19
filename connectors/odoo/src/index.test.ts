import { describe, expect, it } from 'vitest';

import { CONECTOR } from './index';

describe('@aiw/connector-odoo', () => {
  it('se declara como conector MCP', () => {
    expect(CONECTOR.protocolo).toBe('mcp');
  });
});
