import { describe, expect, it } from 'vitest';

import {
  PAQUETE,
  casoDorado,
  casoDoradoEstructurado,
  evaluarCasoDorado,
  evaluarCasoDoradoEstructurado,
} from './index';

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

  it('rechaza un caso dorado estructurado sin identificador', () => {
    expect(() =>
      casoDoradoEstructurado({ id: ' ', puesto: 'x', entrada: {}, esperado: { a: 1 } }),
    ).toThrow();
  });

  it('evalúa un caso dorado estructurado por igualdad de la salida, no por referencia', () => {
    const caso = casoDoradoEstructurado({
      id: 'e-1',
      puesto: 'x',
      entrada: {},
      esperado: { proponerNota: true, motivo: 'vencida' },
    });
    expect(
      evaluarCasoDoradoEstructurado(caso, { proponerNota: true, motivo: 'vencida' }).superado,
    ).toBe(true);
    const fallido = evaluarCasoDoradoEstructurado(caso, { proponerNota: false, motivo: 'vencida' });
    expect(fallido.superado).toBe(false);
    expect(fallido.diagnostico).toContain('e-1');
  });
});
