/**
 * `leerCarga` sobre las dos formas en las que el MCP dinámico real (FastMCP)
 * devuelve la salida estructurada: `structuredContent` y su texto JSON
 * equivalente. Ver el README del conector para la forma exacta por herramienta.
 */
import { describe, expect, it } from 'vitest';

import { leerCarga } from './cliente.js';
import { ErrorConector } from './errores.js';
import { leerRegistros } from './mapeo.js';

/** Datos inventados: ninguna factura, cliente ni empresa real. */
const REGISTRO = {
  id: 91,
  name: 'F-2026-0901',
  partner_id: [21, 'Distribuciones de Muestra SL'],
  amount_residual: 99.9,
  currency_id: [1, 'EUR'],
  invoice_date: '2026-09-01',
  invoice_date_due: '2026-09-15',
};

/** Forma real de `search_records`: un objeto con `success`, `count` y `result`. */
const CARGA_FASTMCP = { success: true, count: 1, result: [REGISTRO], fields_used: ['id', 'name'] };

describe('leerCarga sobre las dos formas de FastMCP', () => {
  it('lee la envolvente «result» desde structuredContent', () => {
    const carga = leerCarga({ structuredContent: CARGA_FASTMCP }, 'search_records');
    expect(carga).toEqual(CARGA_FASTMCP);
    expect(leerRegistros(carga)).toEqual([REGISTRO]);
  });

  it('lee la misma envolvente «result» desde el texto JSON equivalente, sin structuredContent', () => {
    const resultado = { content: [{ type: 'text', text: JSON.stringify(CARGA_FASTMCP) }] };
    const carga = leerCarga(resultado, 'search_records');
    expect(carga).toEqual(CARGA_FASTMCP);
    expect(leerRegistros(carga)).toEqual([REGISTRO]);
  });
});

describe('leerCarga con un fallo «blando» (success: false, isError sin marcar)', () => {
  it('lo traduce a ErrorConector con el motivo y el detalle del ERP', () => {
    const resultado = {
      structuredContent: { success: false, error: 'Access denied for model account.move' },
    };
    try {
      leerCarga(resultado, 'search_records');
      expect.unreachable('debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorConector);
      expect((error as ErrorConector).motivo).toBe('no_autorizado');
      expect((error as ErrorConector).message).toContain('Access denied for model account.move');
    }
  });

  it('una respuesta de éxito normal no se confunde con un fallo blando', () => {
    expect(leerCarga({ structuredContent: CARGA_FASTMCP }, 'search_records')).toEqual(
      CARGA_FASTMCP,
    );
  });

  it('lo encuentra también anidado en «result», la envolvente real de las herramientas de escritura', () => {
    // chatter_post, preview_write, validate_write y execute_approved_write
    // declaran su tipo de vuelta como un diccionario genérico: FastMCP envuelve
    // la respuesta entera en result, así que un rechazo real de Odoo (permiso,
    // registro inexistente…) queda anidado ahí, no en el nivel superior.
    const resultado = {
      structuredContent: {
        result: {
          success: false,
          tool: 'execute_approved_write',
          error: 'Record does not exist: account.move(999999,)',
        },
      },
    };
    try {
      leerCarga(resultado, 'execute_approved_write');
      expect.unreachable('debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorConector);
      expect((error as ErrorConector).motivo).toBe('no_encontrada');
      expect((error as ErrorConector).message).toContain(
        'Record does not exist: account.move(999999,)',
      );
    }
  });

  it('una escritura de éxito real, con «result» anidado dos veces, no se confunde con un fallo', () => {
    const resultado = {
      structuredContent: {
        result: {
          success: true,
          tool: 'execute_approved_write',
          model: 'mail.activity',
          operation: 'create',
          result: 5501,
          instance: 'pruebas',
        },
      },
    };
    expect(leerCarga(resultado, 'execute_approved_write')).toEqual(resultado.structuredContent);
  });
});
