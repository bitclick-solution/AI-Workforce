/** La tabla de patrones nombre→días y el resolutor por forma de pago. */
import { describe, expect, it } from 'vitest';

import type { DetalleDeFactura } from './markdown.js';
import { diasDePlazo, resolutorPorFormaDePago, sinVencimiento } from './vencimiento.js';

describe('diasDePlazo', () => {
  it.each([
    ['CONTADO', 1, 0],
    ['RECIBO A 30 DIAS', 1, 30],
    ['120 DIAS', 1, 120],
    ['PAGO A 45 DÍAS', 1, 45],
  ])('«%s» con %i vencimiento es %i días', (nombre, vencimientos, dias) => {
    expect(diasDePlazo(nombre, vencimientos)).toBe(dias);
  });

  it.each([
    ['varios vencimientos', '30.60.90', 3],
    [
      'varios vencimientos aunque el nombre diga días',
      'TRANSFERENCIA BANCARIA 3 VENCIMIENTOS A 30 DIAS',
      3,
    ],
    ['un vencimiento sin días en el nombre', 'RECIBO DOMICILIADO', 1],
    ['un vencimiento sin días en el nombre (tarjeta)', 'TARJETA CREDITO', 1],
    ['un vencimiento sin días en el nombre (cheque)', 'CHEQUE', 1],
  ])('no se deriva: %s', (_caso, nombre, vencimientos) => {
    expect(diasDePlazo(nombre, vencimientos)).toBeUndefined();
  });
});

const FORMAS = [
  '- **CONTADO** (`000`) · 1 vencimiento(s)',
  '- **RECIBO A 30 DIAS** (`001`) · 1 vencimiento(s)',
  '- **RECIBO DOMICILIADO** (`REC`) · 1 vencimiento(s)',
  '- **30.60.90** (`369`) · 3 vencimiento(s)',
].join('\n');

function factura(forma?: string): DetalleDeFactura {
  return {
    id: '1-000101',
    serie: '1',
    numero: 101,
    clienteNombre: 'EJEMPLO',
    clienteNif: 'B00000001',
    fecha: '2026-07-01',
    estado: 'pendiente',
    total: 1,
    ...(forma === undefined ? {} : { formaDePago: { codigo: forma } }),
    cobros: { tipo: 'ninguno' },
    abonos: 'ninguno',
  };
}

describe('resolutorPorFormaDePago', () => {
  const resolutor = resolutorPorFormaDePago(() => Promise.resolve(FORMAS));

  it('suma los días de la forma a la fecha de la factura', async () => {
    expect(await resolutor.derivar(factura('001'))).toBe('2026-07-31');
    expect(await resolutor.derivar(factura('000'))).toBe('2026-07-01');
  });

  it.each([
    ['sin forma de pago', undefined],
    ['código desconocido', 'ZZZ'],
    ['un vencimiento sin días en el nombre', 'REC'],
    ['varios vencimientos', '369'],
  ])('no deriva nada: %s', async (_caso, codigo) => {
    expect(await resolutor.derivar(factura(codigo))).toBeUndefined();
  });

  it('lee las formas una sola vez y reintenta si la lectura falla', async () => {
    let lecturas = 0;
    let falla = true;
    const otro = resolutorPorFormaDePago(() => {
      lecturas += 1;
      return falla ? Promise.reject(new Error('Read timed out')) : Promise.resolve(FORMAS);
    });
    await expect(otro.derivar(factura('001'))).rejects.toThrow(/timed out/);
    falla = false;
    await otro.derivar(factura('001'));
    await otro.derivar(factura('000'));
    expect(lecturas).toBe(2);
  });

  it('una respuesta que no es la lista de formas es invalido', async () => {
    const roto = resolutorPorFormaDePago(() => Promise.resolve('Otra cosa'));
    await expect(roto.derivar(factura('001'))).rejects.toMatchObject({ motivo: 'invalido' });
  });

  it('sinVencimiento no deriva nada', async () => {
    expect(await sinVencimiento.derivar(factura('001'))).toBeUndefined();
  });
});
