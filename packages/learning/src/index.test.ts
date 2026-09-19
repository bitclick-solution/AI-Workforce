import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/learning', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/learning');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
