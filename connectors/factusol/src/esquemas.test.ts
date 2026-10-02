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
import { ESQUEMA_ENTRADA_LISTAR, ESQUEMA_ENTRADA_NOTA } from './esquema-json.js';

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
  const valida = { factura_id: '1-000042', texto: 'Llamada al contacto de facturación.' };

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
      id: '1-000042',
      numero: 'F-2026-0412',
      cliente: { id: '7', nombre: 'Ferretería Ejemplo SA' },
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
      id: 'BORR-0001',
      factura_id: '1-000042',
      tipo: 'nota',
      creado_en: '2026-09-21T08:30:00.000Z',
    };
    expect(SalidaCrearNotaSeguimiento.parse(salida).creado_en).toBe('2026-09-21T08:30:00.000Z');
    expect(
      SalidaCrearNotaSeguimiento.safeParse({ ...salida, creado_en: '2026-09-21' }).success,
    ).toBe(false);
  });
});
