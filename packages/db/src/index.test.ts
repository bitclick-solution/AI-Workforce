import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index.js';

describe('@aiw/db', () => {
  it('se declara con su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/db');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(0);
  });
});
