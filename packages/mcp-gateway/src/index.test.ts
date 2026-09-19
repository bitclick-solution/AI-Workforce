import { describe, expect, it } from 'vitest';

import { PAQUETE } from './index';

describe('@aiw/mcp-gateway', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/mcp-gateway');
    expect(PAQUETE.responsabilidad.length).toBeGreaterThan(10);
  });
});
