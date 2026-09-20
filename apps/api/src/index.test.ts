import { describe, expect, it } from 'vitest';

import { APLICACION } from './index';

describe('@aiw/api', () => {
  it('declara su nombre y los paquetes de los que depende', () => {
    expect(APLICACION.nombre).toBe('@aiw/api');
    expect(APLICACION.dependeDe).toEqual([
      '@aiw/db',
      '@aiw/domain',
      '@aiw/ledger',
      '@aiw/mcp-gateway',
    ]);
  });
});
