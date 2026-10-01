/** El analizador sobre las formas exactas del informe del Probador, con valores inventados. */
import { describe, expect, it } from 'vitest';

import {
  analizarCliente,
  analizarDetalleDeFactura,
  analizarFormasDePago,
  analizarListaDeFacturas,
  esNoEncontrado,
  leerImporte,
} from './markdown.js';

const LISTA = [
  '**Factura 1-000123**',
  '- Cliente: EJEMPLO S.L. (B00000001)',
  '- Fecha: 2026-09-22',
  '- Estado: pendiente',
  '- Total: 1.21 €',
  '',
  '**Factura A-000007**',
  '- Cliente: MUESTRA (SUCURSAL) S.A. (A00000002)',
  '- Fecha: 2026-09-01',
  '- Estado: Pendiente',
  '- Total: 1234.50 €',
].join('\n');

const DETALLE = (
  cobros: string,
  abonos = '- ninguno enlazado a esta factura y ninguno sin enlazar que la cite en su referencia',
): string =>
  [
    '**Factura 1-000123**',
    '- Cliente: EJEMPLO S.L. (B00000001)',
    '- Fecha: 2026-09-22',
    '- Estado: pendiente',
    '- Total: 1.21 €',
    '- Almacén: GEN',
    '- Forma de pago: 001 · RECIBO A 30 DIAS',
    '- Base imponible: 1.00 € · IVA: 0.21 €',
    '',
    '**Líneas:**',
    '- Artículo de ejemplo (ART001) — 1.0 x 1.00 € = 1.00 € · sin origen registrado',
    '- CONCEPTO SUELTO — 1.0 x 30.00 € = 30.00 €',
    '',
    '**Cobros:**',
    cobros,
    '',
    '**Abonos:**',
    abonos,
  ].join('\n');

describe('analizarListaDeFacturas', () => {
  it('lee los bloques del informe', () => {
    expect(analizarListaDeFacturas(LISTA)).toEqual([
      {
        id: '1-000123',
        serie: '1',
        numero: 123,
        clienteNombre: 'EJEMPLO S.L.',
        clienteNif: 'B00000001',
        fecha: '2026-09-22',
        estado: 'pendiente',
        total: 1.21,
      },
      expect.objectContaining({
        id: 'A-000007',
        serie: 'A',
        numero: 7,
        clienteNombre: 'MUESTRA (SUCURSAL) S.A.',
        clienteNif: 'A00000002',
        estado: 'pendiente',
        total: 1234.5,
      }),
    ]);
  });

  it('tolera saltos de línea de Windows', () => {
    expect(analizarListaDeFacturas(LISTA.replaceAll('\n', '\r\n'))).toHaveLength(2);
  });

  it.each([
    ['sin ningún bloque', 'Hay 3 facturas.'],
    ['sin Cliente', LISTA.replace('- Cliente: EJEMPLO S.L. (B00000001)\n', '')],
    ['cliente sin NIF', LISTA.replace('EJEMPLO S.L. (B00000001)', 'EJEMPLO S.L.')],
    ['fecha ilegible', LISTA.replace('2026-09-22', '22/09/2026')],
    ['fecha inexistente', LISTA.replace('2026-09-22', '2026-02-31')],
    ['importe sin euro', LISTA.replace('1.21 €', '1.21')],
    ['importe con coma', LISTA.replace('1.21 €', '1,21 €')],
    ['importe con miles', LISTA.replace('1234.50 €', '1,234.50 €')],
    ['sin Estado', LISTA.replace('- Estado: pendiente\n', '')],
  ])('un bloque que no encaja (%s) es invalido y no devuelve datos a medias', (_caso, texto) => {
    expect(() => analizarListaDeFacturas(texto)).toThrowError(
      expect.objectContaining({ motivo: 'invalido' }),
    );
  });
});

describe('analizarDetalleDeFactura', () => {
  it('sin cobros ni abonos, con su forma de pago', () => {
    expect(analizarDetalleDeFactura(DETALLE('- ninguno registrado'))).toMatchObject({
      id: '1-000123',
      total: 1.21,
      formaDePago: { codigo: '001', nombre: 'RECIBO A 30 DIAS' },
      cobros: { tipo: 'ninguno' },
      abonos: 'ninguno',
    });
  });

  it('suma los cobros legibles', () => {
    const cobros = [
      '- 2026-06-01: 69.76 € (cobro) — Cobro factura nº:3-000045, remesa:1',
      '- 2026-09-15: 0.24 € (cobro) — COBRO FACTURA Nº: 3 - 000045',
    ].join('\n');
    expect(analizarDetalleDeFactura(DETALLE(cobros)).cobros).toEqual({
      tipo: 'importe',
      total: 70,
    });
  });

  it('un cobro que no sabe leer es ilegible, no un error del listado', () => {
    expect(analizarDetalleDeFactura(DETALLE('- 2026-06-01: 5.00 € (devolución)')).cobros).toEqual({
      tipo: 'ilegible',
    });
    expect(analizarDetalleDeFactura(DETALLE('- cobro raro')).cobros).toEqual({ tipo: 'ilegible' });
  });

  it('los abonos no se mezclan con los cobros y cualquier abono lo marca', () => {
    const conAbono = DETALLE(
      '- ninguno registrado',
      '- Posible abono sin enlazar: 1-000045 · 2026-09-22 · 1.21 € · devuelta · en su referencia dice «Factura 123»\n- Los importes de arriba (total y cobros) no restan abonos.',
    );
    expect(analizarDetalleDeFactura(conAbono)).toMatchObject({
      cobros: { tipo: 'ninguno' },
      abonos: 'hay',
    });
  });

  it('forma de pago: solo el código, «ninguna» o ausente', () => {
    const sin = (linea: string): string =>
      DETALLE('- ninguno registrado').replace('- Forma de pago: 001 · RECIBO A 30 DIAS', linea);
    expect(analizarDetalleDeFactura(sin('- Forma de pago: DOS')).formaDePago).toEqual({
      codigo: 'DOS',
    });
    expect(analizarDetalleDeFactura(sin('- Forma de pago: ninguna')).formaDePago).toBeUndefined();
    expect(analizarDetalleDeFactura(sin('- Almacén: GEN')).formaDePago).toBeUndefined();
  });

  it('el texto libre de líneas y cobros no pisa los campos de cabecera', () => {
    const texto = DETALLE('- ninguno registrado').replace(
      '- CONCEPTO SUELTO',
      '- Estado: cobrada — CONCEPTO SUELTO',
    );
    expect(analizarDetalleDeFactura(texto).estado).toBe('pendiente');
  });

  it('sin el bloque de cobros o vacío es invalido', () => {
    const sinBloque = DETALLE('- ninguno registrado').replace(
      '**Cobros:**\n- ninguno registrado',
      '',
    );
    expect(() => analizarDetalleDeFactura(sinBloque)).toThrowError(/Cobros/);
    expect(() => analizarDetalleDeFactura(DETALLE(''))).toThrowError(/vacío/);
  });

  it('sin la sección de abonos se marca, no se supone', () => {
    const texto = DETALLE('- ninguno registrado').split('\n**Abonos:**')[0] ?? '';
    expect(analizarDetalleDeFactura(texto).abonos).toBe('sin_seccion');
  });

  it('dos facturas en el detalle es invalido', () => {
    expect(() => analizarDetalleDeFactura(LISTA)).toThrowError(
      expect.objectContaining({ motivo: 'invalido' }),
    );
  });
});

describe('analizarFormasDePago', () => {
  const TEXTO = [
    '- **CONTADO** (`000`) · 1 vencimiento(s)',
    '- **RECIBO A 30 DIAS** (`001`) · 1 vencimiento(s)',
    '- **30.60.90** (`369`) · 3 vencimiento(s)',
    '- **CHEQUE** (`CHE`) · 1 vencimiento(s)',
  ].join('\n');

  it('lee código, nombre y número de vencimientos', () => {
    const formas = analizarFormasDePago(TEXTO);
    expect(formas.get('001')).toEqual({
      codigo: '001',
      nombre: 'RECIBO A 30 DIAS',
      vencimientos: 1,
    });
    expect(formas.get('369')?.vencimientos).toBe(3);
    expect(formas.get('CHE')?.nombre).toBe('CHEQUE');
  });

  it.each([
    ['vacío', ''],
    ['una línea que no encaja', `${TEXTO}\nOtra cosa`],
  ])('%s es invalido', (_caso, texto) => {
    expect(() => analizarFormasDePago(texto)).toThrowError(
      expect.objectContaining({ motivo: 'invalido' }),
    );
  });
});

describe('analizarCliente', () => {
  const FICHA = [
    '**EJEMPLO S.L.** (B00000001 · NIE)',
    '- Código: 12',
    '- Nombre comercial: Ejemplo',
    '- Domicilio: Calle de Prueba, 1 (00000, PROVINCIA)',
    '- Teléfono: 000000000',
  ].join('\n');

  it('saca el código y el nombre', () => {
    expect(analizarCliente(FICHA, 'B00000001')).toEqual({
      codigo: '12',
      nombre: 'EJEMPLO S.L.',
      nif: 'B00000001',
    });
  });

  it.each([
    ['sin código', FICHA.replace('- Código: 12\n', '')],
    ['código no numérico', FICHA.replace('12', 'X')],
    ['sin cabecera', FICHA.replace('**EJEMPLO S.L.** (B00000001 · NIE)\n', '')],
    ['otro NIF', FICHA.replace('B00000001', 'Q00000009')],
    ['dos fichas', `${FICHA}\n${FICHA}`],
  ])('%s es invalido', (_caso, texto) => {
    expect(() => analizarCliente(texto, 'B00000001')).toThrowError(
      expect.objectContaining({ motivo: 'invalido' }),
    );
  });
});

describe('textos sueltos', () => {
  it('reconoce el «no encontrado» del informe', () => {
    expect(esNoEncontrado('No se ha encontrado la factura 1-999999.')).toBe(true);
    expect(esNoEncontrado('**Factura 1-000123**')).toBe(false);
  });

  it('importes en euros con punto decimal', () => {
    expect(leerImporte('0.00 €', 'x')).toBe(0);
    expect(leerImporte('19.98 €', 'x')).toBe(19.98);
    expect(() => leerImporte('19,98 €', 'x')).toThrowError(/importe/);
    expect(() => leerImporte('19.98 $', 'x')).toThrowError(/importe/);
  });
});
