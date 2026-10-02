/** Esquemas del contrato: valores por defecto, límites y lo que se rechaza. */
import { describe, expect, it } from 'vitest';

import {
  EntradaCrearNotaSeguimiento,
  EntradaListarFacturasVencidas,
  Factura,
  FechaCalendario,
  Moneda,
  SalidaCrearNotaSeguimiento,
} from './esquemas.js';
import {
  EntradaLeerExtractoBancario,
  EntradaProponerAsientoDiferencia,
  SalidaProponerAsientoDiferencia,
} from './esquemas-conciliacion.js';
import {
  ESQUEMA_ENTRADA_ASIENTO,
  ESQUEMA_ENTRADA_EXTRACTO,
  ESQUEMA_ENTRADA_LISTAR,
  ESQUEMA_ENTRADA_NOTA,
} from './esquema-json.js';

describe('entrada de listar_facturas_vencidas', () => {
  it('tiene los valores por defecto del contrato', () => {
    expect(EntradaListarFacturasVencidas.parse({})).toEqual({
      dias_vencida_minimo: 1,
      limite: 50,
    });
  });

  it('acepta los extremos del rango', () => {
    expect(EntradaListarFacturasVencidas.parse({ dias_vencida_minimo: 0, limite: 1 }).limite).toBe(
      1,
    );
    expect(EntradaListarFacturasVencidas.parse({ limite: 200 }).limite).toBe(200);
  });

  it.each([
    ['límite cero', { limite: 0 }],
    ['límite por encima de 200', { limite: 500 }],
    ['días vencida negativos', { dias_vencida_minimo: -1 }],
    ['días vencida con decimales', { dias_vencida_minimo: 1.5 }],
    ['un campo que el contrato no tiene', { credencial: 'loQueSea' }],
  ])('rechaza %s', (_caso, entrada) => {
    expect(EntradaListarFacturasVencidas.safeParse(entrada).success).toBe(false);
  });
});

describe('entrada de crear_nota_seguimiento', () => {
  const valida = { factura_id: 42, texto: 'Llamada al contacto de facturación.' };

  it('el tipo por defecto es nota', () => {
    expect(EntradaCrearNotaSeguimiento.parse(valida).tipo).toBe('nota');
  });

  it('acepta una actividad con fecha límite', () => {
    const entrada = { ...valida, tipo: 'actividad', fecha_limite: '2026-10-01' };
    expect(EntradaCrearNotaSeguimiento.parse(entrada).fecha_limite).toBe('2026-10-01');
  });

  it.each([
    ['texto vacío', { ...valida, texto: '' }],
    ['texto de más de 2000 caracteres', { ...valida, texto: 'a'.repeat(2001) }],
    ['texto con etiquetas HTML', { ...valida, texto: 'Aviso <b>urgente</b>' }],
    ['texto con entidades HTML', { ...valida, texto: 'Aviso &amp; seguimiento' }],
    ['fecha límite sin actividad', { ...valida, fecha_limite: '2026-10-01' }],
    ['fecha límite que no existe', { ...valida, tipo: 'actividad', fecha_limite: '2026-02-30' }],
    ['tipo desconocido', { ...valida, tipo: 'recordatorio' }],
    ['factura sin identificar', { texto: 'Hola' }],
    ['clave de idempotencia vacía', { ...valida, clave_idempotencia: '' }],
  ])('rechaza %s', (_caso, entrada) => {
    expect(EntradaCrearNotaSeguimiento.safeParse(entrada).success).toBe(false);
  });

  it('ninguna herramienta acepta credenciales por argumento', () => {
    const campos = [
      ...Object.keys(ESQUEMA_ENTRADA_LISTAR.properties),
      ...Object.keys(ESQUEMA_ENTRADA_NOTA.properties),
    ];
    expect(
      campos.some((campo) => /clave_api|pass|token|secret|usuario|credencial|url/i.test(campo)),
    ).toBe(false);
    expect(ESQUEMA_ENTRADA_LISTAR.additionalProperties).toBe(false);
    expect(ESQUEMA_ENTRADA_NOTA.additionalProperties).toBe(false);
  });
});

describe('tipos del contrato', () => {
  it('la moneda va en ISO 4217', () => {
    expect(Moneda.safeParse('EUR').success).toBe(true);
    expect(Moneda.safeParse('eur').success).toBe(false);
    expect(Moneda.safeParse('€').success).toBe(false);
  });

  it('la fecha existe en el calendario', () => {
    expect(FechaCalendario.safeParse('2026-09-21').success).toBe(true);
    expect(FechaCalendario.safeParse('2026-09-31').success).toBe(false);
    expect(FechaCalendario.safeParse('21/09/2026').success).toBe(false);
  });

  it('una factura del contrato lleva días vencida positivos', () => {
    const factura = {
      id: 42,
      numero: 'F-2026-0412',
      cliente: { id: 7, nombre: 'Ferretería Ejemplo SA' },
      importe_pendiente: 1840,
      moneda: 'EUR',
      fecha_emision: '2026-08-10',
      fecha_vencimiento: '2026-09-09',
      dias_vencida: 12,
    };
    expect(Factura.parse(factura).dias_vencida).toBe(12);
    expect(Factura.safeParse({ ...factura, dias_vencida: 0 }).success).toBe(false);
  });

  it('la nota devuelve fecha de creación en ISO 8601', () => {
    const salida = {
      id: 9001,
      factura_id: 42,
      tipo: 'nota',
      creado_en: '2026-09-21T08:30:00.000Z',
    };
    expect(SalidaCrearNotaSeguimiento.parse(salida).creado_en).toBe('2026-09-21T08:30:00.000Z');
    expect(
      SalidaCrearNotaSeguimiento.safeParse({ ...salida, creado_en: '2026-09-21' }).success,
    ).toBe(false);
  });
});

describe('esquemas de conciliación bancaria', () => {
  const extracto = { cuenta_id: '7', desde: '2026-09-01', hasta: '2026-09-30' };
  const asiento = {
    apunte_id: '301',
    documento_id: '46',
    importe_diferencia: -12.5,
    cuenta_contrapartida: '629000',
    motivo: 'Comisión bancaria.',
  };

  it('leer_extracto_bancario tiene los valores por defecto del contrato', () => {
    expect(EntradaLeerExtractoBancario.parse({})).toEqual({ solo_sin_casar: true, limite: 50 });
  });

  it.each([
    ['límite cero', { limite: 0 }],
    ['límite por encima de 200', { limite: 201 }],
    ['hasta anterior a desde', { desde: '2026-09-30', hasta: '2026-09-01' }],
    ['fecha que no existe', { desde: '2026-02-30' }],
    ['un campo que el contrato no tiene', { clave_api: 'x' }],
  ])('leer_extracto_bancario rechaza %s', (_caso, entrada) => {
    expect(EntradaLeerExtractoBancario.safeParse({ ...extracto, ...entrada }).success).toBe(false);
  });

  it.each([
    ['sin documento', { documento_id: undefined }],
    ['sin cuenta de contrapartida', { cuenta_contrapartida: undefined }],
    ['diferencia cero', { importe_diferencia: 0 }],
    ['diferencia con tres decimales', { importe_diferencia: 1.005 }],
    ['motivo vacío', { motivo: '' }],
    ['motivo de más de 500 caracteres', { motivo: 'a'.repeat(501) }],
    ['motivo con HTML', { motivo: 'Comisión <b>bancaria</b>' }],
    ['clave de idempotencia vacía', { clave_idempotencia: '' }],
  ])('proponer_asiento_diferencia rechaza %s', (_caso, cambio) => {
    expect(EntradaProponerAsientoDiferencia.safeParse({ ...asiento, ...cambio }).success).toBe(
      false,
    );
  });

  it('proponer_asiento_diferencia acepta el asiento válido', () => {
    expect(EntradaProponerAsientoDiferencia.safeParse(asiento).success).toBe(true);
  });

  it('el asiento solo se devuelve en borrador', () => {
    const salida = {
      id: '7001',
      apunte_id: '301',
      estado: 'borrador',
      creado_en: '2026-09-21T08:30:00.000Z',
    };
    expect(SalidaProponerAsientoDiferencia.safeParse(salida).success).toBe(true);
    expect(
      SalidaProponerAsientoDiferencia.safeParse({ ...salida, estado: 'contabilizado' }).success,
    ).toBe(false);
  });

  it('el esquema JSON anunciado dice lo mismo que el esquema Zod', () => {
    expect(Object.keys(ESQUEMA_ENTRADA_EXTRACTO.properties).sort()).toEqual(
      Object.keys(EntradaLeerExtractoBancario.shape).sort(),
    );
    expect(Object.keys(ESQUEMA_ENTRADA_ASIENTO.properties).sort()).toEqual(
      Object.keys(EntradaProponerAsientoDiferencia.shape).sort(),
    );
    expect([...ESQUEMA_ENTRADA_ASIENTO.required].sort()).toEqual(
      ['apunte_id', 'cuenta_contrapartida', 'documento_id', 'importe_diferencia', 'motivo'].sort(),
    );
    expect(ESQUEMA_ENTRADA_EXTRACTO.properties.limite.maximum).toBe(200);
    expect(ESQUEMA_ENTRADA_ASIENTO.properties.motivo.maxLength).toBe(500);
  });

  it('ninguna herramienta de conciliación acepta credenciales por argumento', () => {
    const campos = [
      ...Object.keys(ESQUEMA_ENTRADA_EXTRACTO.properties),
      ...Object.keys(ESQUEMA_ENTRADA_ASIENTO.properties),
    ];
    expect(
      campos.some((campo) => /clave_api|pass|token|secret|usuario|credencial|url/i.test(campo)),
    ).toBe(false);
  });
});
