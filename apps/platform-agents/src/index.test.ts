import { describe, expect, it } from 'vitest';

import { APLICACION } from './index';

describe('@aiw/platform-agents', () => {
  it('declara su nombre y los paquetes de los que depende', () => {
    expect(APLICACION.nombre).toBe('@aiw/platform-agents');
    expect(APLICACION.dependeDe).toEqual(['@aiw/domain', '@aiw/learning', '@aiw/rooms']);
  });
});
