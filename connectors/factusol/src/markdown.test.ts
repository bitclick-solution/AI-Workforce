/** El analizador sobre las formas exactas del informe del Probador, con valores inventados. */
import { describe, expect, it } from 'vitest';

import {
  analizarCliente,
  analizarDetalleDeFactura,
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

const DETALLE = (cobros: string): string =>
  [
    '**Factura 1-000123**',
    '- Cliente: EJEMPLO S.L. (B00000001)',
    '- Fecha: 2026-09-22',
    '- Estado: pendiente',
    '- Total: 1.21 €',
    '- Base imponible: 1.00 € · IVA: 0.21 €',
    '**Líneas:**',
    '- Concepto — 1.0 x 1.00 € = 1.00 €',
    '**Cobros:**',
    cobros,
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
  it('sin cobros', () => {
    expect(analizarDetalleDeFactura(DETALLE('- ninguno registrado'))).toMatchObject({
      id: '1-000123',
      total: 1.21,
      sinCobros: true,
    });
  });

  it('con algún cobro no es sinCobros', () => {
    expect(analizarDetalleDeFactura(DETALLE('- Cobro de prueba 0.50 €')).sinCobros).toBe(false);
  });

  it('sin el bloque de cobros o vacío es invalido', () => {
    const sinBloque = DETALLE('- ninguno registrado').replace('**Cobros:**\n', '');
    expect(() => analizarDetalleDeFactura(sinBloque)).toThrowError(/Cobros/);
    expect(() => analizarDetalleDeFactura(DETALLE(''))).toThrowError(/vacío/);
  });

  it('dos facturas en el detalle es invalido', () => {
    expect(() => analizarDetalleDeFactura(LISTA)).toThrowError(
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
