import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/domain', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/domain');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
