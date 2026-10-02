import { describe, expect, it } from 'vitest';

import type { PasoDeLaTarea } from '../../../../../lib/inicio';
import { estadoDeLaTarea, etiquetaDeNivel, tituloDelPaso } from './presentacion';

function paso(parcial: Partial<PasoDeLaTarea>): PasoDeLaTarea {
  return {
    orden: 1,
    tipo: 'herramienta',
    accion: 'herramienta.llamada',
    herramienta: 'leer_facturas',
    resultado: 'exito',
    costeEuros: 0,
    nivel: null,
    claseAccion: null,
    porque: null,
    creadoEn: '2026-10-02T09:00:00.000Z',
    ...parcial,
  };
}

describe('tituloDelPaso', () => {
  it.each([
    [{ tipo: 'arranque', accion: 'tarea.contada', herramienta: null }, 'Recibió el encargo'],
    [{}, 'Usó «leer_facturas»'],
    [
      { accion: 'herramienta.rechazada' },
      'Intentó usar «leer_facturas» y la política no se lo permitió',
    ],
    [{ accion: 'herramienta.simulada' }, 'Simuló «leer_facturas»: no escribió nada de verdad'],
    [{ accion: 'herramienta.saltada' }, 'No usó «leer_facturas» porque se rechazó la aprobación'],
    [{ tipo: 'aprobacion_pedida', accion: 'aprobacion.solicitada' }, 'Pidió tu aprobación'],
    [{ tipo: 'decision', accion: 'aprobacion.aprobada' }, 'Se aprobó'],
    [{ tipo: 'decision', accion: 'aprobacion.rechazada' }, 'Se rechazó'],
    [{ tipo: 'decision', accion: 'aprobacion.editada' }, 'Se aprobó con cambios'],
    [{ tipo: 'decision', accion: 'aprobacion.vencida' }, 'La aprobación venció sin respuesta'],
  ] as [Partial<PasoDeLaTarea>, string][])('%j → «%s»', (parcial, esperado) => {
    expect(tituloDelPaso(paso(parcial))).toBe(esperado);
  });

  it('sin nombre de herramienta no inventa uno', () => {
    expect(tituloDelPaso(paso({ herramienta: null }))).toBe('Usó una herramienta');
  });
});

describe('etiquetaDeNivel y estadoDeLaTarea', () => {
  it('da nombre a los cuatro niveles y no rompe con uno desconocido', () => {
    expect(etiquetaDeNivel('n0')).toBe('N0 · manual');
    expect(etiquetaDeNivel('n1')).toBe('N1 · supervisado');
    expect(etiquetaDeNivel('n2')).toBe('N2 · autónomo con aviso');
    expect(etiquetaDeNivel('n3')).toBe('N3 · autónomo con muestreo');
    expect(etiquetaDeNivel('n9')).toBe('N9');
  });

  it('cada estado se dice con palabras y un estado desconocido se muestra tal cual', () => {
    expect(estadoDeLaTarea('esperando_aprobacion')).toEqual({
      etiqueta: 'Esperando tu aprobación',
      tono: 'aviso',
    });
    expect(estadoDeLaTarea('completada').tono).toBe('exito');
    expect(estadoDeLaTarea('fallida').tono).toBe('peligro');
    expect(estadoDeLaTarea('raro')).toEqual({ etiqueta: 'raro', tono: 'neutro' });
  });
});
