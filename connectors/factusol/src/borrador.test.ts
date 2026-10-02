import { describe, expect, it } from 'vitest';

import { leerBorrador, leerCambios, leerIdDeBorrador } from './borrador.js';

/** Forma real de `structuredContent` de `draft_modificar_cliente` (muestra del Probador, 1-10). */
const REAL = (valorActual: string | null, nuevo = 'x'): Record<string, unknown> => ({
  texto: '📋 **BORRADOR · Modificar cliente**',
  borrador: {
    draft_id: 'dft_20261001_185932_bfb3c8',
    tipo: 'modificar_cliente',
    forma: 'maestro',
    titulo: 'Modificar cliente EJEMPLO UNO S.L.',
    caduca_en: '2026-10-01T19:29:32+00:00',
    aviso: null,
    cuerpo: {
      entidad: 'cliente',
      operacion: 'modificacion',
      identificador: '12',
      campos: [
        { nombre: 'Observaciones', valor_actual: valorActual, valor_nuevo: nuevo, cambia: true },
      ],
    },
  },
});

describe('leerBorrador', () => {
  it('lee draft_id y el valor actual de Observaciones', () => {
    expect(leerBorrador(REAL('Había esto.'))).toEqual({
      draftId: 'dft_20261001_185932_bfb3c8',
      observacionesActuales: 'Había esto.',
    });
  });

  it('un valor actual vacío o nulo es una observación vacía', () => {
    expect(leerBorrador(REAL('')).observacionesActuales).toBe('');
    expect(leerBorrador(REAL(null)).observacionesActuales).toBe('');
  });

  it.each([
    ['texto suelto', '**Borrador** creado'],
    ['sin borrador', { texto: 'x' }],
    ['sin draft_id', { borrador: { cuerpo: { campos: [] } } }],
    ['sin el campo Observaciones', { borrador: { draft_id: 'B1', cuerpo: { campos: [] } } }],
    ['la forma antigua supuesta', { draft_id: 'B1', observaciones: { valor_actual: '' } }],
    [
      'campo sin valor_nuevo',
      {
        borrador: {
          draft_id: 'B1',
          cuerpo: { campos: [{ nombre: 'Observaciones', valor_actual: '' }] },
        },
      },
    ],
    [
      'valor_actual que no es texto',
      {
        borrador: {
          draft_id: 'B1',
          cuerpo: { campos: [{ nombre: 'Observaciones', valor_actual: 5, valor_nuevo: 'x' }] },
        },
      },
    ],
  ])('%s es invalido', (_caso, carga) => {
    expect(() => leerBorrador(carga)).toThrowError(expect.objectContaining({ motivo: 'invalido' }));
  });

  it('leerCambios indexa por nombre en minúsculas y leerIdDeBorrador sobrevive a un diff roto', () => {
    expect(leerCambios(REAL('a', 'b')).get('observaciones')).toEqual({
      actual: 'a',
      nuevo: 'b',
      cambia: true,
    });
    expect(leerIdDeBorrador({ borrador: { draft_id: 'B9' } })).toBe('B9');
    expect(leerIdDeBorrador('nada')).toBeUndefined();
  });
});
