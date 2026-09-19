import { describe, expect, it } from 'vitest';

import { APLICACION } from './index';

describe('@aiw/channels', () => {
  it('declara su nombre y los paquetes de los que depende', () => {
    expect(APLICACION.nombre).toBe('@aiw/channels');
    expect(APLICACION.dependeDe).toEqual(['@aiw/domain', '@aiw/notifications']);
  });
});
