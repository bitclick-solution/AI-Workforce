import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/notifications', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/notifications');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
