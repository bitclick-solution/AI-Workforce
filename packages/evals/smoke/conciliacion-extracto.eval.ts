import { describe, expect, it } from 'vitest';

import {
  CASO_APUNTE_SIN_DOCUMENTO,
  CASO_CONCILIACION_EXTRACTO,
  CASO_DEVOLUCION_DE_RECIBO,
  ejecutarCasoApunteSinDocumento,
  ejecutarCasoConciliacionExtracto,
  ejecutarCasoDevolucionDeRecibo,
  evaluarConciliacionConExtracto,
  EXTRACTO,
  EXTRACTO_DEVOLUCION,
} from '../src/puestos/conciliacion.js';

/**
 * Casos dorados del puesto de Conciliación con extracto (`conciliacion-002`).
 * Deterministas y sin coste. Cada propiedad lleva su contraejemplo: un evaluador que
 * no sabe fallar no certifica nada.
 */

const CORRECTO = {
  resumen: 'Informe de prueba.',
  casados: [
    { apunte_id: 'apt-0001', documento_id: 'inv-0002' },
    { apunte_id: 'apt-0004', documento_id: 'inv-0001' },
  ],
  asientos: [
    {
      apunte_id: 'apt-0002',
      documento_id: 'inv-0003',
      importe_diferencia: -10,
      cuenta_contrapartida: '629000',
      motivo: 'Diferencia de -10.00 €.',
      estado: 'borrador',
      asiento_id: 'asi-0001',
    },
  ],
  escaladas: [
    { apunte_id: 'apt-0003', causa: 'sin_documento', motivo: 'Sin documento.' },
    { apunte_id: 'apt-0005', causa: 'sin_documento', motivo: 'Sin documento.' },
  ],
};

function evaluar(cambios: Record<string, unknown>) {
  return evaluarConciliacionConExtracto(
    JSON.stringify({ ...CORRECTO, ...cambios }),
    EXTRACTO,
    CASO_CONCILIACION_EXTRACTO,
  );
}

describe('evals de humo · Conciliación con extracto', () => {
  it('conciliacion-002: casa, propone la diferencia y escala lo que no casa', () => {
    const resultado = ejecutarCasoConciliacionExtracto();
    expect(resultado.diagnostico).toContain(CASO_CONCILIACION_EXTRACTO);
    expect(resultado.superado).toBe(true);
    expect(resultado.puntuacion).toBe(1);
  });

  it('variante: la devolución de recibo se escala sin asiento', () => {
    const resultado = ejecutarCasoDevolucionDeRecibo();
    expect(resultado.diagnostico).toContain(CASO_DEVOLUCION_DE_RECIBO);
    expect(resultado.superado).toBe(true);
  });

  it('variante: el apunte sin documento se escala sin asiento', () => {
    const resultado = ejecutarCasoApunteSinDocumento();
    expect(resultado.diagnostico).toContain(CASO_APUNTE_SIN_DOCUMENTO);
    expect(resultado.superado).toBe(true);
  });

  it('el informe correcto de los contraejemplos pasa: si no, no prueban nada', () => {
    expect(evaluar({}).superado).toBe(true);
  });

  it('falla si propone un asiento para un apunte sin documento', () => {
    const resultado = evaluar({
      asientos: [
        ...CORRECTO.asientos,
        {
          apunte_id: 'apt-0005',
          documento_id: 'inv-0001',
          importe_diferencia: -740.5,
          cuenta_contrapartida: '629000',
          estado: 'borrador',
        },
      ],
    });
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain(
      'ningún asiento para un apunte sin documento — apt-0005',
    );
  });

  it('falla si el asiento no es borrador, no lleva contrapartida o cita otro documento', () => {
    const base = CORRECTO.asientos[0];
    expect(evaluar({ asientos: [{ ...base, estado: 'contabilizado' }] }).superado).toBe(false);
    expect(evaluar({ asientos: [{ ...base, cuenta_contrapartida: '' }] }).superado).toBe(false);
    expect(evaluar({ asientos: [{ ...base, documento_id: null }] }).superado).toBe(false);
    expect(evaluar({ asientos: [{ ...base, importe_diferencia: -9 }] }).superado).toBe(false);
  });

  it('falla si un apunte casado no cita su documento', () => {
    const resultado = evaluar({ casados: [{ apunte_id: 'apt-0001', documento_id: null }] });
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('cada apunte casado cita su documento');
  });

  it('falla si cita un apunte que el extracto no contiene', () => {
    const resultado = evaluar({
      casados: [...CORRECTO.casados, { apunte_id: 'apt-9999', documento_id: 'inv-0001' }],
    });
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain(
      'no cita un apunte que el extracto no contiene — apt-9999',
    );
  });

  it('falla si la devolución de recibo lleva asiento o no se escala', () => {
    const extracto = EXTRACTO_DEVOLUCION;
    const conAsiento = JSON.stringify({
      casados: [],
      escaladas: [{ apunte_id: 'apt-0101', causa: 'devolucion_recibo' }],
      asientos: [
        {
          apunte_id: 'apt-0101',
          documento_id: 'inv-0002',
          importe_diferencia: -636,
          cuenta_contrapartida: '629000',
          estado: 'borrador',
        },
      ],
    });
    const sinEscalar = JSON.stringify({ casados: [], escaladas: [], asientos: [] });
    expect(evaluarConciliacionConExtracto(conAsiento, extracto, 'x').superado).toBe(false);
    expect(evaluarConciliacionConExtracto(sinEscalar, extracto, 'x').superado).toBe(false);
  });

  it('falla si escala dos veces el mismo apunte', () => {
    const resultado = evaluar({
      escaladas: [...CORRECTO.escaladas, CORRECTO.escaladas[0]],
    });
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('una sola escalada por apunte — apt-0003');
  });

  it('falla con puntuación 0 si no entrega JSON con el formato del informe', () => {
    const resultado = evaluarConciliacionConExtracto('He conciliado.', EXTRACTO, 'x');
    expect(resultado.superado).toBe(false);
    expect(resultado.puntuacion).toBe(0);
  });
});
