/** Los cuatro motivos, sus códigos y qué se reintenta. */
import { describe, expect, it } from 'vitest';

import {
  CODIGO_POR_MOTIVO,
  ErrorConector,
  LIMITE_DETALLE,
  MOTIVOS,
  motivoDeMensaje,
  recortarDetalle,
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

describe('traducción de los fallos de Factusol MCP', () => {
  it.each([
    ['No se ha encontrado la factura 1-999999.', 'no_encontrada'],
    ['HTTP 401 Unauthorized', 'no_autorizado'],
    ['403 Forbidden: scope insuficiente', 'no_autorizado'],
    ['Token inválido o caducado', 'no_autorizado'],
    ['Read timed out after 60s talking to Factusol', 'temporal'],
    ['fetch failed: ECONNREFUSED factusol-mcp:8000', 'temporal'],
    ['HTTP 503 Service Unavailable', 'temporal'],
    ['circuit breaker abierto', 'temporal'],
    ['Rate limit por tenant superado', 'temporal'],
    ['Error de validación: campo obligatorio ausente', 'invalido'],
  ])('«%s» es %s', (mensaje, motivo) => {
    expect(motivoDeMensaje(mensaje)).toBe(motivo);
  });

  it('lo que no encaja se declara temporal y se reintenta', () => {
    expect(motivoDeMensaje('algo raro pasó')).toBe('temporal');
  });

  it('el cuerpo íntegro de Factusol no entra en el mensaje', () => {
    const traza = [
      '403 Forbidden: no autorizado para modificar este documento',
      'Traceback (most recent call last):',
      '  File "/usr/lib/python3/factusol_mcp/servidor.py", line 4821, in comprobar',
      'SELECT * FROM F_CLI WHERE CODCLI = 12',
    ].join('\n');
    const fallo = traducirError(new Error(traza), 'No se pudo anotar');
    expect(fallo.motivo).toBe('no_autorizado');
    expect(fallo.message).not.toContain('Traceback');
    expect(fallo.message).not.toContain('SELECT');
    expect(fallo.message).not.toContain('servidor.py');
  });

  it('un detalle larguísimo se queda en el límite y se marca recortado', () => {
    const largo = `Validation: ${'dato interno '.repeat(200)}`;
    const recortado = recortarDetalle(largo);
    expect(recortado.length).toBe(LIMITE_DETALLE + 1);
    expect(recortado.endsWith('…')).toBe(true);
    expect(traducirError(new Error(largo), 'Contexto').message.length).toBeLessThan(
      LIMITE_DETALLE + 50,
    );
  });

  it('un detalle corto pasa entero y sin espacios sobrantes', () => {
    expect(recortarDetalle('  Token   caducado  ')).toBe('Token caducado');
  });

  it('conserva el motivo de un ErrorConector y añade contexto al resto', () => {
    const propio = new ErrorConector('invalido', 'entrada mala');
    expect(traducirError(propio, 'Contexto')).toBe(propio);

    const ajeno = traducirError(new Error('401 Unauthorized'), 'No se pudo anotar');
    expect(ajeno.motivo).toBe('no_autorizado');
    expect(ajeno.message).toBe('No se pudo anotar: 401 Unauthorized');
  });
});
