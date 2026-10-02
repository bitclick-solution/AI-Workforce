// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetalleDeTarea } from '../../../../../lib/inicio';
import { VistaDelDetalle } from './vista';

let avisarCambio: (() => void) | undefined;
let bajas = 0;

vi.mock('../../../../../lib/sala-fuente', () => ({
  crearFuente: () => ({
    salas: () => Promise.resolve([{ id: 's1', ambito: 'equipo' }]),
    miembros: () => Promise.resolve([]),
    suscribir: (_id: string, alCambiar: () => void) => {
      avisarCambio = alCambiar;
      return () => {
        bajas += 1;
      };
    },
    indicarEscritura: () => undefined,
  }),
}));

const TAREA = 't1';

function detalle(parcial: Partial<DetalleDeTarea> = {}): DetalleDeTarea {
  return {
    tareaId: TAREA,
    encargo: 'Revisa las facturas vencidas de hoy.',
    estado: 'esperando_aprobacion',
    puestoId: 'p-cobros',
    agente: 'Cobros',
    departamento: 'Finanzas',
    desde: new Date(Date.now() - 120_000).toISOString(),
    actualizadoEn: new Date().toISOString(),
    costeEuros: 0.0123,
    costeTotalEuros: 0.0123,
    delegadas: [],
    pasos: [
      {
        orden: 1,
        tipo: 'arranque',
        accion: 'tarea.contada',
        herramienta: null,
        resultado: 'exito',
        costeEuros: 0,
        nivel: null,
        claseAccion: null,
        porque: null,
        creadoEn: new Date(Date.now() - 110_000).toISOString(),
      },
      {
        orden: 2,
        tipo: 'herramienta',
        accion: 'herramienta.llamada',
        herramienta: 'listar_facturas_vencidas',
        resultado: 'exito',
        costeEuros: 0.0023,
        nivel: 'n0',
        claseAccion: 'lectura_erp',
        porque: null,
        creadoEn: new Date(Date.now() - 100_000).toISOString(),
      },
      {
        orden: 3,
        tipo: 'aprobacion_pedida',
        accion: 'aprobacion.solicitada',
        herramienta: null,
        resultado: 'exito',
        costeEuros: 0,
        nivel: 'n1',
        claseAccion: null,
        porque: 'Escribir en el ERP exige tu aprobación en nivel N1.',
        creadoEn: new Date(Date.now() - 90_000).toISOString(),
      },
    ],
    aprobacionPendiente: {
      aprobacionId: 'a1',
      claseAccion: 'escritura_erp',
      nivelExigido: 'n1',
      resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
      creadoEn: new Date(Date.now() - 90_000).toISOString(),
      venceEn: null,
      puedeDecidir: true,
    },
    ...parcial,
  };
}

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado });
}

function buscarDeMuestra(lecturas: (() => Response)[], decidirEstado = 200) {
  const llamadas: { url: string; init?: RequestInit | undefined }[] = [];
  let siguiente = 0;
  const buscar = vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    if (url === `/api/inicio/tareas/${TAREA}`) {
      const lectura = lecturas[Math.min(siguiente, lecturas.length - 1)];
      siguiente += 1;
      return (lectura ?? (() => respuestaJson({}, 500)))();
    }
    if (url.startsWith('/api/inicio/avisos/') && url.endsWith('/decidir')) {
      return decidirEstado === 200
        ? respuestaJson({ aprobacionId: 'a1', yaEstaba: false, sentido: 'aprobada' })
        : respuestaJson({ error: 'Ya no se puede decidir.' }, decidirEstado);
    }
    return respuestaJson({});
  });
  const lecturasHechas = () =>
    llamadas.filter((l) => l.url === `/api/inicio/tareas/${TAREA}`).length;
  return { buscar, llamadas, lecturasHechas };
}

beforeEach(() => {
  avisarCambio = undefined;
  bajas = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('VistaDelDetalle', () => {
  it('muestra el encargo, el agente, el estado, el coste y los pasos en orden', async () => {
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: detalle() })]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);

    expect(
      await screen.findByRole('heading', { name: 'Revisa las facturas vencidas de hoy.' }),
    ).toBeTruthy();
    expect(screen.getAllByText('Cobros').length).toBeGreaterThan(0);
    expect(screen.getByTestId('detalle-estado').textContent).toContain('Esperando tu aprobación');
    expect(screen.getByTestId('detalle-coste').textContent).toContain('0,0123');

    const pasos = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(pasos).toHaveLength(3);
    expect(pasos[0]).toContain('Recibió el encargo');
    expect(pasos[0]).not.toContain('no anota el motivo');
    expect(pasos[1]).toContain('Usó «listar_facturas_vencidas»');
    expect(pasos[1]).toContain('N0 · manual');
    expect(pasos[1]).toContain('0,0023');
    expect(pasos[1]).toContain('no anota el motivo');
    expect(pasos[2]).toContain('Pidió tu aprobación');
    expect(pasos[2]).toContain('Escribir en el ERP exige tu aprobación en nivel N1.');
  });

  it('sin delegadas no pinta la sección; con delegadas las lista con enlace, estado y coste, y suma el total', async () => {
    const sin = buscarDeMuestra([() => respuestaJson({ tarea: detalle() })]);
    vi.stubGlobal('fetch', sin.buscar);
    const primera = render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByRole('heading', { name: 'Revisa las facturas vencidas de hoy.' });
    expect(screen.queryByTestId('detalle-delegadas')).toBeNull();
    primera.unmount();
    cleanup();

    const con = detalle({
      costeTotalEuros: 0.0323,
      delegadas: [
        {
          tareaId: 't2',
          tareaPadreId: TAREA,
          encargo: 'Concilia el extracto con las facturas cobradas.',
          estado: 'en_curso',
          puestoId: 'p-conciliacion',
          agente: 'Conciliación',
          departamento: 'Finanzas',
          cruzaDepartamento: false,
          desde: new Date().toISOString(),
          costeEuros: 0.02,
        },
        {
          tareaId: 't3',
          tareaPadreId: 't2',
          encargo: null,
          estado: 'pendiente',
          puestoId: 'p-cobros',
          agente: 'Cobros',
          departamento: 'Finanzas',
          cruzaDepartamento: true,
          desde: new Date().toISOString(),
          costeEuros: 0,
        },
      ],
    });
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: con })]);
    vi.stubGlobal('fetch', buscar);
    render(<VistaDelDetalle tareaId={TAREA} />);

    const seccion = await screen.findByTestId('detalle-delegadas');
    const filas = Array.from(seccion.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toContain('Conciliación');
    expect(filas[0]).toContain('Concilia el extracto con las facturas cobradas.');
    expect(filas[0]).toContain('En curso');
    expect(filas[0]).toContain('0,02');
    expect(filas[1]).toContain('Cobros');
    expect(filas[1]).toContain('Sin encargo anotado');
    expect(filas[1]).toContain('otro departamento');
    const enlace = seccion.querySelector('a[href="/panel/inicio/tarea/t2"]');
    expect(enlace).not.toBeNull();
    expect(screen.getByTestId('detalle-coste').textContent).toContain('0,0323');
    expect(screen.getByTestId('detalle-coste').textContent).toContain('con delegadas');
  });

  it('una aprobación pendiente enseña lo que va a escribir y se aprueba por la ruta de los avisos', async () => {
    const aprobada = detalle({
      estado: 'en_curso',
      aprobacionPendiente: null,
    });
    const { buscar, llamadas } = buscarDeMuestra([
      () => respuestaJson({ tarea: detalle() }),
      () => respuestaJson({ tarea: aprobada }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect(await screen.findByText('Enviar la nota de seguimiento a Contoso.')).toBeTruthy();
    expect(screen.getByText('Necesita a una persona')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => {
      expect(screen.queryByText('Enviar la nota de seguimiento a Contoso.')).toBeNull();
    });
    const decision = llamadas.filter((l) => l.url === '/api/inicio/avisos/a1/decidir');
    expect(decision).toHaveLength(1);
    expect(decision[0]?.init?.method).toBe('POST');
    expect(decision[0]?.init?.body).toBe(JSON.stringify({ sentido: 'aprobada' }));
    expect(screen.getByTestId('detalle-estado').textContent).toContain('En curso');
  });

  it('rechazar manda el sentido rechazada', async () => {
    const { buscar, llamadas } = buscarDeMuestra([
      () => respuestaJson({ tarea: detalle() }),
      () => respuestaJson({ tarea: detalle({ aprobacionPendiente: null }) }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByText('Enviar la nota de seguimiento a Contoso.');
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    await waitFor(() => {
      expect(llamadas.some((l) => l.url === '/api/inicio/avisos/a1/decidir')).toBe(true);
    });
    const decision = llamadas.find((l) => l.url === '/api/inicio/avisos/a1/decidir');
    expect(decision?.init?.body).toBe(JSON.stringify({ sentido: 'rechazada' }));
  });

  it('si la decisión falla, lo dice y deja los botones para reintentar', async () => {
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: detalle() })], 409);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByText('Enviar la nota de seguimiento a Contoso.');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    expect((await screen.findByTestId('detalle-error-decision')).textContent).toContain(
      'Ya no se puede decidir.',
    );
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeTruthy();
    expect(screen.getByText('Enviar la nota de seguimiento a Contoso.')).toBeTruthy();
  });

  it('si la aprobación se le pidió a otra persona, enseña el resumen sin botones de decidir', async () => {
    const base = detalle();
    const ajena = detalle({
      aprobacionPendiente: base.aprobacionPendiente
        ? { ...base.aprobacionPendiente, puedeDecidir: false }
        : null,
    });
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: ajena })]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect(await screen.findByText('Enviar la nota de seguimiento a Contoso.')).toBeTruthy();
    expect(screen.getByTestId('detalle-aprobacion-ajena').textContent).toContain(
      'se la han pedido a otra persona',
    );
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rechazar' })).toBeNull();
  });

  it('estado vacío: una tarea sin pasos aún lo dice y ofrece actualizar', async () => {
    const { buscar } = buscarDeMuestra([
      () =>
        respuestaJson({
          tarea: detalle({
            estado: 'pendiente',
            pasos: [],
            aprobacionPendiente: null,
            costeEuros: 0,
          }),
        }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect((await screen.findByTestId('detalle-sin-pasos')).textContent).toContain(
      'todavía no ha dado ningún paso',
    );
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeTruthy();
  });

  it('estado de error: si el detalle no carga, lo dice y reintenta a petición', async () => {
    const { buscar, lecturasHechas } = buscarDeMuestra([
      () => respuestaJson({ error: 'El inicio no responde.' }, 502),
      () => respuestaJson({ tarea: detalle() }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect((await screen.findByTestId('detalle-error')).textContent).toContain(
      'No se ha podido cargar',
    );
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByRole('heading', { name: 'Revisa las facturas vencidas de hoy.' }),
    ).toBeTruthy();
    expect(lecturasHechas()).toBe(2);
  });

  it('una tarea que no existe (o es de otra organización) lo dice sin más detalle', async () => {
    const { buscar } = buscarDeMuestra([
      () => respuestaJson({ error: 'Esa tarea no existe.' }, 404),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect((await screen.findByTestId('detalle-no-existe')).textContent).toContain(
      'No encontramos esa tarea',
    );
    expect(screen.queryByTestId('detalle-error')).toBeNull();
  });

  it('una tarea fallida se explica con el motivo del último paso con error', async () => {
    const base = detalle();
    const fallida = detalle({
      estado: 'fallida',
      aprobacionPendiente: null,
      pasos: [
        ...base.pasos.slice(0, 2),
        {
          orden: 3,
          tipo: 'herramienta',
          accion: 'herramienta.llamada',
          herramienta: 'enviar_nota',
          resultado: 'error',
          costeEuros: 0,
          nivel: 'n1',
          claseAccion: null,
          porque: 'El ERP no respondió.',
          creadoEn: new Date().toISOString(),
        },
      ],
    });
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: fallida })]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    expect((await screen.findByTestId('detalle-fallida')).textContent).toContain(
      'El ERP no respondió.',
    );
  });

  it('en tiempo real: un aviso de la conexión de Centrifugo vuelve a leer el detalle y llegan los pasos', async () => {
    const base = detalle({
      pasos: [],
      aprobacionPendiente: null,
      estado: 'en_curso',
      costeEuros: 0,
    });
    const { buscar, lecturasHechas } = buscarDeMuestra([
      () => respuestaJson({ tarea: base }),
      () => respuestaJson({ tarea: detalle({ estado: 'en_curso', aprobacionPendiente: null }) }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByTestId('detalle-sin-pasos');
    await waitFor(() => expect(avisarCambio).toBeDefined());

    act(() => avisarCambio?.());

    expect(await screen.findByText('Usó «listar_facturas_vencidas»')).toBeTruthy();
    expect(lecturasHechas()).toBe(2);
    expect(screen.queryByTestId('detalle-sin-pasos')).toBeNull();
  });

  it('con Centrifugo caído, el respaldo periódico sigue trayendo los pasos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { buscar, lecturasHechas } = buscarDeMuestra([
      () => respuestaJson({ tarea: detalle({ pasos: [], aprobacionPendiente: null }) }),
      () => respuestaJson({ tarea: detalle({ aprobacionPendiente: null }) }),
    ]);
    vi.stubGlobal('fetch', buscar);

    render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByTestId('detalle-sin-pasos');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(await screen.findByText('Usó «listar_facturas_vencidas»')).toBeTruthy();
    expect(lecturasHechas()).toBeGreaterThanOrEqual(2);
  });

  it('al salir de la página da de baja la suscripción', async () => {
    const { buscar } = buscarDeMuestra([() => respuestaJson({ tarea: detalle() })]);
    vi.stubGlobal('fetch', buscar);

    const { unmount } = render(<VistaDelDetalle tareaId={TAREA} />);
    await screen.findByText('Enviar la nota de seguimiento a Contoso.');
    await waitFor(() => expect(avisarCambio).toBeDefined());
    unmount();
    await waitFor(() => expect(bajas).toBe(1));
  });
});
