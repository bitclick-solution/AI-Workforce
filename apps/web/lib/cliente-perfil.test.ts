// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  actualizarPresencia,
  guardarDisposicionPanel,
  leerDisposicionPanel,
} from './cliente-perfil';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('actualizarPresencia', () => {
  it('manda PATCH con el valor y sin fallo si la API responde bien', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', buscar);
    expect(await actualizarPresencia(false)).toEqual({});
    expect(buscar).toHaveBeenCalledWith('/api/perfil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mostrarPresencia: false }),
    });
  });

  it('si la API falla, devuelve el motivo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    expect(await actualizarPresencia(true)).toEqual({
      fallo: 'No se pudo guardar el ajuste. Vuelve a intentarlo.',
    });
  });
});

describe('leerDisposicionPanel', () => {
  it('devuelve la disposición guardada', async () => {
    const disposicion = [{ id: 'saludo', tamano: 'mediano' as const, oculto: false }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ disposicionPanel: disposicion })),
    );
    expect(await leerDisposicionPanel()).toEqual(disposicion);
  });

  it('sin sesión o sin API, devuelve una lista vacía en vez de lanzar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    expect(await leerDisposicionPanel()).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('sin red'))),
    );
    expect(await leerDisposicionPanel()).toEqual([]);
  });
});

describe('guardarDisposicionPanel', () => {
  it('manda PATCH con la disposición', async () => {
    const buscar = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', buscar);
    const disposicion = [{ id: 'equipo', tamano: 'grande' as const, oculto: true }];
    expect(await guardarDisposicionPanel(disposicion)).toEqual({});
    expect(buscar).toHaveBeenCalledWith('/api/perfil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disposicionPanel: disposicion }),
    });
  });

  it('si la API falla, devuelve el motivo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    expect(await guardarDisposicionPanel([])).toEqual({
      fallo: 'No se pudo guardar la disposición del panel.',
    });
  });
});
