// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VistaDelContador } from './vista';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VistaDelContador', () => {
  it('muestra el aviso de error con Reintentar y, al pulsarlo, vuelve a llamar a la API', async () => {
    const buscar = vi.fn(
      async () => new Response(JSON.stringify({ error: 'La API no responde.' }), { status: 502 }),
    );
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelContador />);

    await waitFor(() => {
      expect(screen.getByTestId('contador-error')).toBeTruthy();
    });
    expect(screen.getByText('La API no responde.')).toBeTruthy();
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith('/api/contador', { cache: 'no-store' });

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(buscar).toHaveBeenCalledTimes(2);
    });
  });

  it('cuando el reintento va bien, deja el aviso de error y muestra el contador', async () => {
    const cuerpoDeExito = {
      consumo: {
        periodo: '2026-09',
        tareas: 3,
        costeModelosEuros: 1.5,
        acciones: 12,
        ultimaAnotacion: 7,
        momento: new Date().toISOString(),
      },
      porPuesto: [],
      tareas: [],
    };
    const buscar = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'La API no responde.' }), { status: 502 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(cuerpoDeExito), { status: 200 }));
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelContador />);

    await waitFor(() => {
      expect(screen.getByTestId('contador-error')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await waitFor(() => {
      expect(screen.getByTestId('contador-panel')).toBeTruthy();
    });
    expect(screen.queryByTestId('contador-error')).toBeNull();
  });
});
