import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/rooms', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/rooms');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
