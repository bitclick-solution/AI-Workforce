// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VistaDeCuenta } from './vista';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ajuste de presencia en /panel/cuenta', () => {
  it('activado por defecto, y al apagarlo llama a PATCH /api/perfil con el nuevo valor', async () => {
    const buscar = vi.fn(async () => Response.json({ mostrarPresencia: false }));
    vi.stubGlobal('fetch', buscar);

    render(<VistaDeCuenta caducaEn={new Date().toISOString()} mostrarPresenciaInicial={true} />);

    const interruptor = screen.getByRole('switch', { name: 'Mostrar mi presencia en las salas' });
    expect(interruptor.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(interruptor);

    await waitFor(() => expect(interruptor.getAttribute('aria-checked')).toBe('false'));
    expect(buscar).toHaveBeenCalledWith(
      '/api/perfil',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ mostrarPresencia: false }),
      }),
    );
  });

  it('si guardar falla, el interruptor vuelve a su valor anterior y avisa', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );

    render(<VistaDeCuenta caducaEn={new Date().toISOString()} mostrarPresenciaInicial={true} />);
    const interruptor = screen.getByRole('switch', { name: 'Mostrar mi presencia en las salas' });

    fireEvent.click(interruptor);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(interruptor.getAttribute('aria-checked')).toBe('true');
  });
});
