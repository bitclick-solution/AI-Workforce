import { describe, expect, it } from 'vitest';

import { estadoCimientos } from './cimientos';

describe('estadoCimientos', () => {
  it('enumera las cuatro piezas de la rebanada de cimientos', () => {
    const estado = estadoCimientos();
    expect(estado.titulo).toContain('Cimientos');
    expect(estado.piezas).toHaveLength(4);
  });
});
