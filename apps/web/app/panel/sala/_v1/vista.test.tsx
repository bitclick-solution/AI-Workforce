// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crearFuenteSimulada } from '../../../../lib/sala-simulada';
import { VistaDeSalaV1 } from './vista';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VistaDeSalaV1', () => {
  it('pinta salas, miembros con su estado en texto y la conversación', async () => {
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={crearFuenteSimulada()} />);

    const panel = await screen.findByTestId('miembros-escritorio');
    await waitFor(() => {
      expect(within(panel).getByText(/Miembros · 9/)).toBeTruthy();
    });
    for (const texto of [
      'En la sala',
      'Escribiendo…',
      'Inactivo',
      'Añadido',
      'Trabajando',
      'Te necesita',
      'En pausa',
    ]) {
      expect(within(panel).getAllByText(new RegExp(texto)).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId('tarjeta-aprobacion')).toBeTruthy();
    expect(screen.getByTestId('tarjeta-propuesta')).toBeTruthy();
  });

  it('anuncia la escritura en vivo con aria-live', async () => {
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={crearFuenteSimulada()} />);
    const indicador = screen.getByTestId('indicador-de-escritura');
    expect(indicador.getAttribute('aria-live')).toBe('polite');
    await waitFor(() => {
      expect(indicador.textContent).toContain('Director de IA está escribiendo…');
    });
  });

  it('muestra el error con Reintentar cuando la fuente falla', async () => {
    const fuente = crearFuenteSimulada({ fallar: true });
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={fuente} />);
    expect(await screen.findByTestId('error-salas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
  });

  it('cambia de sala sin recargar, marca la actual y avisa de la escritura propia', async () => {
    const fuente = crearFuenteSimulada({ escrituraEnVivo: false });
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={fuente} />);

    const [enlace] = await screen.findAllByTestId('sala-marketing');
    if (!enlace) throw new Error('Falta el enlace de #marketing');
    fireEvent.click(enlace);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('marketing');
    });
    expect(screen.getAllByTestId('sala-marketing')[0]?.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/Todavía no hay mensajes en #marketing/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Mensaje para #marketing/), {
      target: { value: 'Hola' },
    });
    expect(fuente.escriturasIndicadas).toEqual(['marketing']);
    const formulario = screen.getByLabelText(/Mensaje para #marketing/).closest('form');
    if (!formulario) throw new Error('Falta el formulario');
    fireEvent.submit(formulario);
    expect(await screen.findByText('Hola')).toBeTruthy();
  });

  it('refleja un cambio de presencia en vivo', async () => {
    const fuente = crearFuenteSimulada({ escrituraEnVivo: false });
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={fuente} />);
    const fila = await screen.findByTestId('miembro-agente-cobros');
    expect(fila.getAttribute('data-estado')).toBe('te-necesita');

    fuente.cambiarPresencia('finanzas', 'agente-cobros', 'en-la-sala');

    await waitFor(() => {
      expect(screen.getByTestId('miembro-agente-cobros').getAttribute('data-estado')).toBe(
        'en-la-sala',
      );
    });
  });

  it('oculta y vuelve a abrir el panel de miembros', async () => {
    render(<VistaDeSalaV1 salaInicial="finanzas" fuente={crearFuenteSimulada()} />);
    fireEvent.click(await screen.findByTestId('ocultar-miembros'));
    expect(screen.queryByTestId('panel-de-miembros')).toBeNull();
    const alternar = screen.getByTestId('alternar-miembros');
    expect(alternar.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(alternar);
    expect(screen.getByTestId('panel-de-miembros')).toBeTruthy();
  });
});
