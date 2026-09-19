import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/ui', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/ui');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
