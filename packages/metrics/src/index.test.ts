import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/metrics', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/metrics');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
