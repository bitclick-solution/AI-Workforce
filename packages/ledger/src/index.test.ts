import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/ledger', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/ledger');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
