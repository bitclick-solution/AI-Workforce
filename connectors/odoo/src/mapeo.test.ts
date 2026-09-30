/** Mapeo de los campos de Odoo al contrato del conector. */
import { describe, expect, it } from 'vitest';

import { ErrorConector } from './errores.js';
import {
  aFactura,
  diasVencida,
  leerCreadoEn,
  leerFecha,
  leerIdentificador,
  leerRegistros,
  leerRelacion,
} from './mapeo.js';

const AHORA = new Date('2026-09-21T09:00:00.000Z');

const REGISTRO = {
  id: 42,
  name: 'F-2026-0412',
  partner_id: [7, 'Ferretería Ejemplo SA'],
  amount_residual: 1840,
  currency_id: [1, 'EUR'],
  invoice_date: '2026-08-10',
  invoice_date_due: '2026-09-09',
};

describe('campos relación', () => {
  it('lee el par [id, nombre] de XML-RPC', () => {
    expect(leerRelacion([7, 'Ferretería Ejemplo SA'], 'partner_id')).toEqual({
      id: 7,
      nombre: 'Ferretería Ejemplo SA',
    });
  });

  it('lee el objeto de JSON-2', () => {
    expect(leerRelacion({ id: 7, display_name: 'Ferretería Ejemplo SA' }, 'partner_id')).toEqual({
      id: 7,
      nombre: 'Ferretería Ejemplo SA',
    });
  });

  it('un campo vacío de Odoo llega como false y no cuela', () => {
    expect(() => leerRelacion(false, 'partner_id')).toThrow(ErrorConector);
  });
});

describe('fechas', () => {
  it('recorta la hora de una fecha-hora de Odoo', () => {
    expect(leerFecha('2026-09-09 23:00:00', 'invoice_date_due')).toBe('2026-09-09');
  });

  it('cuenta días completos en UTC', () => {
    expect(diasVencida('2026-09-09', AHORA)).toBe(12);
    expect(diasVencida('2026-09-21', AHORA)).toBe(0);
    expect(diasVencida('2026-09-22', AHORA)).toBe(-1);
  });

  it('la hora del día no cambia la cuenta', () => {
    expect(diasVencida('2026-09-09', new Date('2026-09-21T23:59:59.000Z'))).toBe(12);
  });
});

describe('registro de account.move a factura', () => {
  it('convierte todos los campos del contrato', () => {
    expect(aFactura(REGISTRO, AHORA)).toEqual({
      id: 42,
      numero: 'F-2026-0412',
      cliente: { id: 7, nombre: 'Ferretería Ejemplo SA' },
      importe_pendiente: 1840,
      moneda: 'EUR',
      fecha_emision: '2026-08-10',
      fecha_vencimiento: '2026-09-09',
      dias_vencida: 12,
    });
  });

  it('pone la moneda en mayúsculas', () => {
    expect(aFactura({ ...REGISTRO, currency_id: [1, 'eur'] }, AHORA).moneda).toBe('EUR');
  });

  it('un registro incompleto falla con motivo invalido y dice qué campo', () => {
    const { name: _sinNumero, ...sinNombre } = REGISTRO;
    try {
      aFactura(sinNombre, AHORA);
      expect.unreachable('el mapeo debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorConector);
      expect((error as ErrorConector).motivo).toBe('invalido');
      expect((error as ErrorConector).message).toContain('name');
    }
  });
});

describe('envolventes del MCP dinámico', () => {
  it('saca la lista de registros de las formas conocidas', () => {
    expect(leerRegistros([REGISTRO])).toHaveLength(1);
    expect(leerRegistros({ records: [REGISTRO] })).toHaveLength(1);
    expect(leerRegistros({ data: { results: [REGISTRO] } })).toHaveLength(1);
  });

  it('saca la lista de la envolvente «result» del MCP dinámico real (FastMCP)', () => {
    expect(leerRegistros({ success: true, count: 1, result: [REGISTRO] })).toEqual([REGISTRO]);
  });

  it('una respuesta sin lista falla en vez de devolver vacío', () => {
    expect(() => leerRegistros({ mensaje: 'vale' })).toThrow(ErrorConector);
  });

  it('saca el identificador de una escritura', () => {
    expect(leerIdentificador({ message_id: 9001 })).toBe(9001);
    expect(leerIdentificador({ result: { id: 5501 } })).toBe(5501);
    expect(leerIdentificador([{ id: 7 }])).toBe(7);
    expect(() => leerIdentificador({ hecho: true })).toThrow(ErrorConector);
  });

  it('prefiere el identificador de «result» al «record_id» que solo repite el argumento', () => {
    // Forma real de `chatter_post`: `record_id` es la factura sobre la que se
    // escribe, no el mensaje creado, que va en `result`.
    expect(
      leerIdentificador({
        success: true,
        mode: 'direct',
        model: 'account.move',
        record_id: 42,
        approval_required: false,
        result: 9001,
      }),
    ).toBe(9001);
  });

  it('prefiere la fecha de creación del ERP y si no la hay usa la del conector', () => {
    expect(leerCreadoEn({ create_date: '2026-09-21 08:30:00' }, AHORA)).toBe(
      '2026-09-21T08:30:00.000Z',
    );
    expect(leerCreadoEn({}, AHORA)).toBe(AHORA.toISOString());
  });
});
