// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VistaDelInicio } from './vista';

vi.mock('../../../lib/sala-fuente', () => ({
  crearFuente: () => ({
    salas: () => Promise.resolve([]),
    miembros: () => Promise.resolve([]),
    suscribir: () => () => undefined,
    indicarEscritura: () => undefined,
  }),
}));

const AGENTE = {
  puestoId: 'p-cobros',
  nombre: 'Cobros',
  estado: 'activo',
  departamentoId: 'd1',
  departamento: 'Finanzas',
  salaId: 's1',
  origenPlantilla: true,
  tareaEnCurso: null,
  ultimasCompletadas: [],
};

const AVISO = {
  aprobacionId: 'a1',
  tareaId: 't1',
  puestoId: 'p-cobros',
  puesto: 'Cobros',
  claseAccion: 'escritura_erp',
  nivelExigido: 'n1',
  resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
  creadoEn: '2026-09-30T09:00:00.000Z',
};

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

function buscarDeMuestra(
  opciones: {
    agentes?: unknown[];
    avisos?: unknown[];
    contador?: unknown;
    encargarOk?: boolean;
    decidirOk?: boolean;
  } = {},
) {
  const llamadas: { url: string; opciones?: RequestInit | undefined }[] = [];
  const buscar = vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, opciones: init });
    if (url === '/api/inicio/agentes') {
      return respuestaJson({ agentes: opciones.agentes ?? [AGENTE] });
    }
    if (url === '/api/inicio/avisos') {
      return respuestaJson({ avisos: opciones.avisos ?? [AVISO] });
    }
    if (url === '/api/contador') {
      return respuestaJson(opciones.contador ?? { consumo: { tareas: 4, costeModelosEuros: 1.2 } });
    }
    if (url === '/api/perfil' && (!init || init.method === undefined)) {
      return respuestaJson({ mostrarPresencia: true, disposicionPanel: [] });
    }
    if (url === '/api/perfil' && init?.method === 'PATCH') {
      return respuestaJson({ mostrarPresencia: true, disposicionPanel: [] });
    }
    if (url === '/api/inicio/encargar') {
      return opciones.encargarOk === false
        ? respuestaJson({ error: 'El encargo no se pudo enviar.' }, 400)
        : respuestaJson({ tareaId: 't-nueva' }, 202);
    }
    if (url.startsWith('/api/inicio/avisos/') && url.endsWith('/decidir')) {
      return opciones.decidirOk === false
        ? respuestaJson({ error: 'Ya no se puede decidir.' }, 409)
        : respuestaJson({ aprobacionId: 'a1', yaEstaba: false, sentido: 'aprobada' });
    }
    return respuestaJson({});
  });
  return { buscar, llamadas };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VistaDelInicio', () => {
  it('lee agentes, avisos y contador al montar, y pinta los seis widgets del catálogo', async () => {
    const { buscar } = buscarDeMuestra();
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelInicio nombre="Jesús" />);

    expect(await screen.findByText('Hola, Jesús.')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('Cobros').length).toBeGreaterThan(0);
    });
    for (const titulo of [
      'Saludo',
      'Contador del periodo',
      'Indicador de la ficha',
      'Tu equipo',
      'Vencido por antigüedad',
      'Lo último',
    ]) {
      expect(screen.getByText(titulo)).toBeTruthy();
    }
    expect(await screen.findByText('Enviar la nota de seguimiento a Contoso.')).toBeTruthy();
  });

  it('encargar llama a /api/inicio/encargar con el puesto y el texto, y vuelve a leer los agentes', async () => {
    const { buscar, llamadas } = buscarDeMuestra();
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelInicio nombre="Jesús" />);
    await screen.findByLabelText('A quién');

    fireEvent.change(screen.getByLabelText('Qué necesitas'), {
      target: { value: 'Revisa las facturas vencidas de hoy.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Encargar' }));

    await waitFor(() => {
      expect(llamadas.some((l) => l.url === '/api/inicio/encargar')).toBe(true);
    });
    expect(await screen.findByTestId('saludo-enviado')).toBeTruthy();
    const llamadaEncargo = llamadas.find((l) => l.url === '/api/inicio/encargar');
    expect(llamadaEncargo?.opciones?.body).toBe(
      JSON.stringify({ puestoId: 'p-cobros', encargo: 'Revisa las facturas vencidas de hoy.' }),
    );
  });

  it('aprobar un aviso lo quita de la lista y no vuelve a llamar dos veces', async () => {
    const { buscar, llamadas } = buscarDeMuestra();
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelInicio nombre="Jesús" />);
    await screen.findByText('Enviar la nota de seguimiento a Contoso.');

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => {
      expect(screen.queryByText('Enviar la nota de seguimiento a Contoso.')).toBeNull();
    });
    expect(llamadas.filter((l) => l.url === '/api/inicio/avisos/a1/decidir')).toHaveLength(1);
  });

  it('sin avisos pendientes, la lista dice que no hay nada', async () => {
    const { buscar } = buscarDeMuestra({ avisos: [] });
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelInicio nombre="Jesús" />);
    expect(await screen.findByText('No hay avisos pendientes.')).toBeTruthy();
  });

  it('subir un widget con el botón de teclado lo mueve antes que el siguiente (criterio de hecho 9)', async () => {
    const { buscar } = buscarDeMuestra();
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelInicio nombre="Jesús" />);
    await screen.findByLabelText('A quién');

    const panel = screen.getByTestId('inicio-panel-de-widgets');
    const tituloAntes = Array.from(panel.querySelectorAll('h3')).map((h) => h.textContent);
    expect(tituloAntes[0]).toBe('Saludo');
    expect(tituloAntes[1]).toBe('Contador del periodo');

    fireEvent.click(screen.getByRole('button', { name: 'Subir «Contador del periodo»' }));

    await waitFor(() => {
      const titulosDespues = Array.from(panel.querySelectorAll('h3')).map((h) => h.textContent);
      expect(titulosDespues[0]).toBe('Contador del periodo');
      expect(titulosDespues[1]).toBe('Saludo');
    });
  });
});
