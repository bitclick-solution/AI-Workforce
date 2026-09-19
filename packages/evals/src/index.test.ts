import { describe, expect, it } from 'vitest';

import { PAQUETE, casoDorado, evaluarCasoDorado } from './index';

describe('@aiw/evals', () => {
  it('declara su nombre y su responsabilidad', () => {
    expect(PAQUETE.nombre).toBe('@aiw/evals');
  });

  it('rechaza un caso dorado sin identificador', () => {
    expect(() => casoDorado({ id: ' ', puesto: 'x', entrada: 'a', esperado: 'b' })).toThrow();
  });

  it('evalúa por igualdad exacta', () => {
    const caso = casoDorado({ id: 'c-1', puesto: 'x', entrada: 'a', esperado: 'b' });
    expect(evaluarCasoDorado(caso, 'b').superado).toBe(true);
    expect(evaluarCasoDorado(caso, 'c').puntuacion).toBe(0);
  });
});
