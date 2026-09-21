/** Los cuatro motivos, sus códigos y qué se reintenta. */
import { describe, expect, it } from 'vitest';

import {
  CODIGO_POR_MOTIVO,
  ErrorConector,
  MOTIVOS,
  motivoDeMensaje,
  traducirError,
} from './errores.js';

describe('motivos', () => {
  it('son exactamente los cuatro del contrato', () => {
    expect([...MOTIVOS]).toEqual(['no_encontrada', 'no_autorizado', 'temporal', 'invalido']);
  });

  it('solo temporal es reintentable', () => {
    for (const motivo of MOTIVOS) {
      expect(new ErrorConector(motivo, 'prueba').reintentable).toBe(motivo === 'temporal');
    }
  });

  it('cada motivo tiene su propio código', () => {
    const codigos = Object.values(CODIGO_POR_MOTIVO);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('los datos del error no llevan nada más que motivo y reintentable', () => {
    expect(new ErrorConector('temporal', 'prueba').datos).toEqual({
      motivo: 'temporal',
      reintentable: true,
    });
  });
});

describe('traducción de los fallos del MCP dinámico', () => {
  it.each([
    ['Record does not exist: account.move(999999,)', 'no_encontrada'],
    ['Odoo ValidationError: unknown record id', 'no_encontrada'],
    ['Access denied for model account.move', 'no_autorizado'],
    ['AccessError: you are not allowed to modify this document', 'no_autorizado'],
    ['Invalid credentials for the Odoo instance', 'no_autorizado'],
    ['Read timed out after 60s talking to Odoo', 'temporal'],
    ['fetch failed: ECONNREFUSED odoo-mcp:8000', 'temporal'],
    ['HTTP 503 Service Unavailable', 'temporal'],
    ['Invalid field account.move.no_existe in domain', 'invalido'],
  ])('«%s» es %s', (mensaje, motivo) => {
    expect(motivoDeMensaje(mensaje)).toBe(motivo);
  });

  it('lo que no encaja se declara temporal y se reintenta', () => {
    expect(motivoDeMensaje('algo raro pasó')).toBe('temporal');
  });

  it('conserva el motivo de un ErrorConector y añade contexto al resto', () => {
    const propio = new ErrorConector('invalido', 'entrada mala');
    expect(traducirError(propio, 'Contexto')).toBe(propio);

    const ajeno = traducirError(new Error('Access denied'), 'No se pudo anotar');
    expect(ajeno.motivo).toBe('no_autorizado');
    expect(ajeno.message).toBe('No se pudo anotar: Access denied');
  });
});
