import { describe, expect, it } from 'vitest';

import { casoDorado, evaluarCasoDorado } from '../src/index';

/**
 * Eval de humo de los cimientos. Es determinista y no llama a ningún modelo:
 * comprueba que el evaluador de casos dorados funciona y que la CI lo ejecuta.
 * Los casos dorados reales por puesto llegan con cada rebanada de agente.
 */
describe('evals de humo · cimientos', () => {
  it('un caso dorado con la salida esperada pasa', () => {
    const caso = casoDorado({
      id: 'cimientos-001',
      puesto: 'plataforma',
      entrada: 'ping',
      esperado: 'pong',
    });
    const resultado = evaluarCasoDorado(caso, 'pong');
    expect(resultado.superado).toBe(true);
    expect(resultado.puntuacion).toBe(1);
  });

  it('un caso dorado con salida distinta falla con diagnóstico', () => {
    const caso = casoDorado({
      id: 'cimientos-002',
      puesto: 'plataforma',
      entrada: 'ping',
      esperado: 'pong',
    });
    const resultado = evaluarCasoDorado(caso, 'peng');
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('cimientos-002');
  });
});
