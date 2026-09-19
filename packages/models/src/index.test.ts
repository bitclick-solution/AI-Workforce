import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/models', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/models');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
