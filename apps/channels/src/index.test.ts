import { describe, expect, it } from 'vitest';

import { APLICACION } from './index';

describe('@aiw/channels', () => {
  it('declara su nombre y los paquetes de los que depende', () => {
    expect(APLICACION.nombre).toBe('@aiw/channels');
    // Con la aprobación por correo pasa a escribir en el libro, así que depende del
    // esquema y del punto único de escritura.
    expect(APLICACION.dependeDe).toEqual([
      '@aiw/db',
      '@aiw/domain',
      '@aiw/ledger',
      '@aiw/notifications',
    ]);
  });
});
