import { describe, expect, it } from 'vitest';

import { leerBorrador } from './borrador.js';

describe('leerBorrador', () => {
  it('lee draft_id y el valor actual de observaciones', () => {
    expect(
      leerBorrador({
        draft_id: 'BORR-0001',
        cambios: { observaciones: { valor_actual: 'Había esto.', valor_nuevo: 'x' } },
      }),
    ).toEqual({ draftId: 'BORR-0001', observacionesActuales: 'Había esto.' });
  });

  it('un valor actual nulo es una observación vacía', () => {
    expect(
      leerBorrador({ draft_id: 'B1', observaciones: { valor_actual: null } }).observacionesActuales,
    ).toBe('');
  });

  it.each([
    ['texto suelto', '**Borrador** creado'],
    ['sin draft_id', { cambios: { observaciones: { valor_actual: '' } } }],
    ['sin observaciones', { draft_id: 'B1', cambios: {} }],
    ['sin valor_actual', { draft_id: 'B1', observaciones: { valor_nuevo: 'x' } }],
    ['valor_actual que no es texto', { draft_id: 'B1', observaciones: { valor_actual: 5 } }],
  ])('%s es invalido', (_caso, carga) => {
    expect(() => leerBorrador(carga)).toThrowError(expect.objectContaining({ motivo: 'invalido' }));
  });
});
