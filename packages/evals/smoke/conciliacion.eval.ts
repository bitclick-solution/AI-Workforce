import { describe, expect, it } from 'vitest';

import { CARTERA } from '../src/puestos/cobros.js';
import {
  CASO_CONCILIACION,
  ejecutarCasoConciliacion,
  evaluarConciliacion,
} from '../src/puestos/conciliacion.js';

/**
 * Caso dorado del puesto de Conciliación. Determinista y sin coste, como el de
 * Cobros, y con un contraejemplo por regla: un evaluador que no sabe fallar no
 * certifica nada.
 */

/** Propuesta correcta para una factura de la cartera. Los contraejemplos la estropean. */
function propuestaDe(numero: string): Record<string, unknown> {
  const factura = CARTERA.find((candidata) => candidata.numero === numero);
  if (!factura) throw new Error(`La cartera no tiene ${numero}.`);
  return {
    factura: factura.numero,
    factura_id: factura.id,
    cliente: factura.cliente.nombre,
    importe: factura.importe_pendiente,
    moneda: factura.moneda,
    asiento_propuesto: [
      { cuenta: '572', concepto: 'Bancos', debe: factura.importe_pendiente, haber: 0 },
      { cuenta: '430', concepto: 'Clientes', debe: 0, haber: factura.importe_pendiente },
    ],
    movimiento_bancario: null,
    estado: 'pendiente_de_extracto',
  };
}

function informe(...propuestas: Record<string, unknown>[]): string {
  return JSON.stringify({ resumen: 'Informe de prueba.', propuestas, no_encontradas: [] });
}

describe('evals de humo · puesto Conciliación', () => {
  it('el agente propone el asiento de la factura pedida y deja el cobro pendiente', () => {
    const resultado = ejecutarCasoConciliacion();
    expect(resultado.diagnostico).toContain(CASO_CONCILIACION);
    expect(resultado.superado).toBe(true);
    expect(resultado.puntuacion).toBe(1);
  });

  it('la propuesta correcta de los contraejemplos pasa: si no, no prueban nada', () => {
    expect(evaluarConciliacion(informe(propuestaDe('F-2026-0001'))).superado).toBe(true);
  });

  it('falla si propone asientos de facturas que nadie ha pedido', () => {
    const resultado = evaluarConciliacion(
      informe(propuestaDe('F-2026-0001'), propuestaDe('F-2026-0002')),
    );
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('propuestas de más: F-2026-0002');
  });

  it('falla si el asiento no cuadra por el importe de la factura', () => {
    const descuadrada = {
      ...propuestaDe('F-2026-0001'),
      asiento_propuesto: [
        { cuenta: '572', concepto: 'Bancos', debe: 1240, haber: 0 },
        { cuenta: '430', concepto: 'Clientes', debe: 0, haber: 1240 },
      ],
    };
    const resultado = evaluarConciliacion(informe(descuadrada));
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('descuadrados: F-2026-0001');
  });

  it('falla si dice que ha visto un cobro sin tener el extracto', () => {
    const inventada = {
      ...propuestaDe('F-2026-0001'),
      movimiento_bancario: { fecha: '2026-09-20', importe: 1240.5 },
      estado: 'conciliada',
    };
    const resultado = evaluarConciliacion(informe(inventada));
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('no se inventa el cobro');
  });

  it('falla si el identificador es de otra factura', () => {
    const cruzada = { ...propuestaDe('F-2026-0001'), factura_id: 'inv-0002' };
    const resultado = evaluarConciliacion(informe(cruzada));
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('mal citadas: F-2026-0001');
  });

  it('falla con puntuación 0 si no entrega JSON, que es el formato del contrato', () => {
    const resultado = evaluarConciliacion('He conciliado la factura F-2026-0001.');
    expect(resultado.superado).toBe(false);
    expect(resultado.puntuacion).toBe(0);
  });
});
