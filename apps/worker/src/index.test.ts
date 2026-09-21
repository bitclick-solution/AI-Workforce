import { describe, expect, it } from 'vitest';

import { APLICACION } from './index';

describe('@aiw/worker', () => {
  it('declara su nombre y los paquetes de los que depende', () => {
    expect(APLICACION.nombre).toBe('@aiw/worker');
    expect(APLICACION.dependeDe).toEqual([
      '@aiw/domain',
      '@aiw/models',
      '@aiw/learning',
      '@aiw/mcp-gateway',
    ]);
  });
});
