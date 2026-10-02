// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClaseDelExpediente, ExpedienteDelPuesto } from '../../../../../../lib/expediente';
import { VistaDelExpediente } from './vista';

const PUESTO = 'p-cobros';
const RUTA = `/api/puestos/${PUESTO}/expediente`;
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

const escritura: ClaseDelExpediente = {
  claseAccion: 'escritura',
  nivel: 'n1',
  prohibida: false,
  ascenso: {
    de: 'n1',
    a: 'n2',
    acciones: { actual: 12, requerido: 30, cumplido: false },
    aprobadasSinCambiosPct: { actual: 96.8, requerido: 95, cumplido: true },
    diasSinIncidentes: { actual: null, requerido: 30, cumplido: false },
    confirmacion: { confirmada: false, cumplido: false },
    cumplidos: 1,
    total: 4,
  },
  sinAscenso: null,
  historial: [
    {
      claseAccion: 'escritura',
      de: 'n0',
      a: 'n1',
      versionPuestoId: 'v3',
      numeroVersion: 3,
      fecha: hace(10),
      leccionId: 'l1',
      decididaPorPersonaId: 'persona-1',
    },
  ],
};

const comunicar: ClaseDelExpediente = {
  claseAccion: 'comunicar',
  nivel: 'n1',
  prohibida: false,
  ascenso: null,
  sinAscenso: 'fijo',
  historial: [],
};

function expediente(parcial: Partial<ExpedienteDelPuesto> = {}): ExpedienteDelPuesto {
  return {
    puestoId: PUESTO,
    nombre: 'Cobros',
    departamento: 'Finanzas',
    estado: 'activo',
    versionActiva: { versionPuestoId: 'v3', numero: 3 },
    versiones: [
      {
        versionPuestoId: 'v1',
        numero: 1,
        creadaEn: hace(60),
        niveles: { escritura: 'n0', comunicar: 'n1' },
        clasesProhibidas: [],
        lecciones: [],
      },
    ],
    clases: [escritura, comunicar],
    lecciones: [
      {
        leccionId: 'l1',
        titulo: 'Saluda por el nombre',
        linea: 'Saluda por el nombre de la persona.',
        estado: 'vigente',
        promocionId: 'pr1',
        versionPuestoId: 'v3',
      },
      {
        leccionId: 'l2',
        titulo: 'Firma con el equipo',
        linea: '',
        estado: 'propuesta',
        promocionId: null,
        versionPuestoId: null,
      },
    ],
    rechazadas: [
      {
        numeroOrden: 7,
        tareaId: 't1',
        claseAccion: 'comunicar',
        herramienta: 'enviar_tercer_aviso',
        nivel: 'n0',
        costeEuros: 0,
        porque: 'La política del puesto exige permiso para esta clase.',
        creadoEn: hace(2),
      },
    ],
    totalRechazadas: 1,
    ...parcial,
  };
}

function fetchDe(...respuestas: (() => Response)[]) {
  let i = 0;
  const buscar = vi.fn(async (url: string) => {
    expect(url).toBe(RUTA);
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i += 1;
    return (r ?? (() => respuestaJson({}, 500)))();
  });
  vi.stubGlobal('fetch', buscar);
  return buscar;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('VistaDelExpediente', () => {
  it('enseña el agente, la versión activa y, por clase, su nivel con el historial', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente() }));
    render(<VistaDelExpediente puestoId={PUESTO} />);

    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeTruthy();
    expect(screen.getByTestId('expediente-version').textContent).toContain('3');
    expect(screen.getByTestId('expediente-estado').textContent).toContain('Activo');

    const clase = screen.getByTestId('clase-escritura');
    expect(clase.textContent).toContain('N1 · supervisado');
    const historial = within(screen.getByTestId('historial-escritura')).getAllByRole('listitem');
    expect(historial[0]?.textContent).toContain('Empezó en N0 · manual');
    expect(historial[1]?.textContent).toContain('Subió de N0 · manual a N1 · supervisado');
    expect(historial[1]?.textContent).toContain('Versión 3');
    expect(historial[1]?.textContent).toContain('por la lección «Saluda por el nombre»');
  });

  it('una clase N1 enseña los cuatro criterios con su valor; la que no tiene dato lo dice', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente() }));
    render(<VistaDelExpediente puestoId={PUESTO} />);
    const ascenso = await screen.findByTestId('ascenso-escritura');
    expect(ascenso.textContent).toContain('1 de 4 criterios cumplidos');
    expect(screen.getByTestId('criterio-escritura-acciones').textContent).toContain('12 de 30');
    expect(screen.getByTestId('criterio-escritura-aprobadas').textContent).toContain('96,8 %');
    expect(screen.getByTestId('criterio-escritura-aprobadas').textContent).toContain('Cumplido');
    expect(screen.getByTestId('criterio-escritura-dias').textContent).toContain(
      'Sin datos todavía',
    );
    expect(screen.getByTestId('criterio-escritura-confirmacion').textContent).toContain(
      'Sin confirmar',
    );
    expect(within(ascenso).getAllByRole('meter')).toHaveLength(4);
  });

  it('una clase fija se dice fija y no enseña ningún medidor', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente() }));
    render(<VistaDelExpediente puestoId={PUESTO} />);
    const texto = await screen.findByTestId('sin-ascenso-comunicar');
    expect(texto.textContent).toContain('Fijo en N1 · supervisado');
    expect(within(screen.getByTestId('clase-comunicar')).queryAllByRole('meter')).toHaveLength(0);
    expect(screen.queryByTestId('ascenso-comunicar')).toBeNull();
  });

  it('las lecciones llevan su estado y las rechazadas su coste, nivel, porqué y enlace a la tarea', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente() }));
    render(<VistaDelExpediente puestoId={PUESTO} />);
    const lecciones = within(await screen.findByTestId('lecciones')).getAllByRole('listitem');
    expect(lecciones[0]?.textContent).toContain('Vigente');
    expect(lecciones[1]?.textContent).toContain('Propuesta');

    const rechazada = within(screen.getByTestId('rechazadas')).getAllByRole('listitem')[0];
    expect(rechazada?.textContent).toContain('«enviar_tercer_aviso»');
    expect(rechazada?.textContent).toContain('N0 · manual');
    expect(rechazada?.textContent).toContain('0,00');
    expect(rechazada?.textContent).toContain('La política del puesto exige permiso');
    expect(
      within(rechazada as HTMLElement)
        .getByRole('link', { name: 'Ver en la tarea' })
        .getAttribute('href'),
    ).toBe('/panel/inicio/tarea/t1#paso-7');
  });

  it('no ofrece ninguna acción de escritura: ni botones ni formularios', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente() }));
    const { container } = render(<VistaDelExpediente puestoId={PUESTO} />);
    await screen.findByRole('heading', { name: 'Cobros' });
    // Único botón: el «Por qué lo hice» plegable de la acción rechazada.
    const botones = screen.queryAllByRole('button');
    expect(botones).toHaveLength(1);
    expect(botones[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('form, input, select, textarea')).toBeNull();
  });

  it('sin lecciones ni rechazadas enseña los estados vacíos', async () => {
    fetchDe(() =>
      respuestaJson({
        expediente: expediente({ lecciones: [], rechazadas: [], totalRechazadas: 0 }),
      }),
    );
    render(<VistaDelExpediente puestoId={PUESTO} />);
    expect((await screen.findByTestId('lecciones-vacio')).textContent).toContain(
      'Todavía no ha aprendido nada',
    );
    expect(screen.getByTestId('rechazadas-vacio').textContent).toContain('ninguna acción');
  });

  it('un puesto sin versión activa lo dice y no pinta secciones vacías', async () => {
    fetchDe(() =>
      respuestaJson({
        expediente: expediente({ versionActiva: null, versiones: [], clases: [], lecciones: [] }),
      }),
    );
    render(<VistaDelExpediente puestoId={PUESTO} />);
    expect((await screen.findByTestId('expediente-sin-version')).textContent).toContain(
      'todavía no tiene versión activa',
    );
    expect(screen.queryByText('Lo que ha aprendido')).toBeNull();
  });

  it('avisa si hay más rechazadas de las que enseña', async () => {
    fetchDe(() => respuestaJson({ expediente: expediente({ totalRechazadas: 120 }) }));
    render(<VistaDelExpediente puestoId={PUESTO} />);
    expect(await screen.findByText(/Mostrando las 1 más recientes de 120/)).toBeTruthy();
  });

  it('estado de error: lo dice y reintenta a petición', async () => {
    const buscar = fetchDe(
      () => respuestaJson({ error: 'El inicio no responde.' }, 502),
      () => respuestaJson({ expediente: expediente() }),
    );
    render(<VistaDelExpediente puestoId={PUESTO} />);
    expect((await screen.findByTestId('expediente-error')).textContent).toContain(
      'No se ha podido cargar',
    );
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Cobros' })).toBeTruthy();
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it('un agente que no existe (o es de otra organización) lo dice sin más detalle', async () => {
    fetchDe(() => respuestaJson({ error: 'Ese puesto no existe.' }, 404));
    render(<VistaDelExpediente puestoId={PUESTO} />);
    expect((await screen.findByTestId('expediente-no-existe')).textContent).toContain(
      'No encontramos ese agente',
    );
    expect(screen.queryByTestId('expediente-error')).toBeNull();
  });
});
