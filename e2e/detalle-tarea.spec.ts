import { expect, test, type Page } from '@playwright/test';

/**
 * Detalle de la tarea en el panel (docs/specs/detalle-de-la-tarea-en-el-panel.md):
 * encargar en el Inicio, abrir el detalle, ver llegar los pasos y aprobar desde
 * el detalle.
 *
 * Igual que `e2e/inicio.spec.ts`, el arnés solo arranca `apps/web`: la API se
 * simula con `page.route` y un estado en memoria que se comporta como la real
 * (el encargo crea la tarea con su entrada de arranque; el agente avanza cuando
 * la prueba lo dice; decidir cierra la aprobación y anota la decisión). El reloj
 * del navegador está controlado para que el refresco de respaldo del panel
 * —el mismo que usa el Inicio— se dispare sin esperar 20 segundos.
 *
 * Todos los datos son de prueba. Las capturas van a `docs/producto/capturas/`.
 */

const CAPTURAS = 'docs/producto/capturas';

type Resultado = 'exito' | 'error' | 'rechazado' | 'parcial';

interface Paso {
  orden: number;
  tipo: 'arranque' | 'herramienta' | 'aprobacion_pedida' | 'decision';
  accion: string;
  herramienta: string | null;
  resultado: Resultado;
  costeEuros: number;
  nivel: 'n0' | 'n1' | 'n2' | 'n3' | null;
  claseAccion: string | null;
  porque: string | null;
  creadoEn: string;
}

interface Tarea {
  tareaId: string;
  encargo: string;
  estado: string;
  puestoId: string;
  agente: string;
  departamento: string;
  desde: string;
  actualizadoEn: string;
  costeEuros: number;
  pasos: Paso[];
  aprobacionPendiente: {
    aprobacionId: string;
    claseAccion: string;
    nivelExigido: string;
    resumenLegible: string;
    creadoEn: string;
    venceEn: string | null;
    puedeDecidir: boolean;
  } | null;
}

const RESUMEN =
  'Enviar a Contoso, S.L. la nota de seguimiento de la factura F-2026-0412 (1.250,00 €, vencida hace 12 días).';

function ahora(): string {
  return new Date().toISOString();
}

/** Estado en memoria de la API simulada. */
function crearApiSimulada() {
  let tarea: Tarea | undefined;
  const decisiones: unknown[] = [];
  const encargos: unknown[] = [];
  let puedeDecidir = true;

  const agentes = () => [
    {
      puestoId: 'p-cobros',
      nombre: 'Cobros',
      estado: 'activo',
      departamentoId: 'd1',
      departamento: 'Finanzas',
      salaId: null,
      origenPlantilla: true,
      tareaEnCurso: tarea
        ? {
            tareaId: tarea.tareaId,
            encargo: tarea.encargo,
            estado: 'en_curso',
            desde: tarea.desde,
          }
        : null,
      ultimasCompletadas: [],
    },
  ];

  const avisos = () =>
    tarea?.aprobacionPendiente && puedeDecidir
      ? [
          {
            aprobacionId: tarea.aprobacionPendiente.aprobacionId,
            tareaId: tarea.tareaId,
            puestoId: 'p-cobros',
            puesto: 'Cobros',
            claseAccion: tarea.aprobacionPendiente.claseAccion,
            nivelExigido: tarea.aprobacionPendiente.nivelExigido,
            resumenLegible: tarea.aprobacionPendiente.resumenLegible,
            creadoEn: tarea.aprobacionPendiente.creadoEn,
          },
        ]
      : [];

  return {
    decisiones: () => decisiones,
    encargos: () => encargos,
    soloVer: () => {
      puedeDecidir = false;
      if (tarea?.aprobacionPendiente) tarea.aprobacionPendiente.puedeDecidir = false;
    },
    agentes,
    avisos,
    tarea: () => tarea,
    encargar(cuerpo: { encargo: string }) {
      encargos.push(cuerpo);
      tarea = {
        tareaId: 't-nueva',
        encargo: cuerpo.encargo,
        estado: 'pendiente',
        puestoId: 'p-cobros',
        agente: 'Cobros',
        departamento: 'Finanzas',
        desde: ahora(),
        actualizadoEn: ahora(),
        costeEuros: 0,
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
            creadoEn: ahora(),
          },
        ],
        aprobacionPendiente: null,
      };
    },
    /** El agente lee las facturas y pide permiso para escribir. */
    avanzarHastaLaAprobacion() {
      if (!tarea) return;
      tarea.estado = 'esperando_aprobacion';
      tarea.costeEuros = 0.0123;
      tarea.pasos.push(
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
          creadoEn: ahora(),
        },
        {
          orden: 3,
          tipo: 'aprobacion_pedida',
          accion: 'aprobacion.solicitada',
          herramienta: null,
          resultado: 'exito',
          costeEuros: 0,
          nivel: 'n1',
          claseAccion: 'escritura_erp',
          porque: 'Escribir en el ERP exige tu aprobación en nivel N1.',
          creadoEn: ahora(),
        },
      );
      tarea.aprobacionPendiente = {
        aprobacionId: 'a-nueva',
        claseAccion: 'escritura_erp',
        nivelExigido: 'n1',
        resumenLegible: RESUMEN,
        creadoEn: ahora(),
        venceEn: null,
        puedeDecidir,
      };
    },
    decidir(cuerpo: { sentido: 'aprobada' | 'rechazada' }) {
      decisiones.push(cuerpo);
      if (!tarea?.aprobacionPendiente) return;
      tarea.aprobacionPendiente = null;
      tarea.estado = cuerpo.sentido === 'aprobada' ? 'en_curso' : 'completada';
      tarea.pasos.push({
        orden: tarea.pasos.length + 1,
        tipo: 'decision',
        accion: cuerpo.sentido === 'aprobada' ? 'aprobacion.aprobada' : 'aprobacion.rechazada',
        herramienta: null,
        resultado: 'exito',
        costeEuros: 0,
        nivel: null,
        claseAccion: null,
        porque: null,
        creadoEn: ahora(),
      });
    },
  };
}

type ApiSimulada = ReturnType<typeof crearApiSimulada>;

async function montarApi(page: Page, api: ApiSimulada) {
  await page.route('**/api/inicio/agentes', (ruta) =>
    ruta.fulfill({ json: { agentes: api.agentes() } }),
  );
  await page.route('**/api/inicio/avisos', (ruta) =>
    ruta.fulfill({ json: { avisos: api.avisos() } }),
  );
  await page.route('**/api/contador', (ruta) =>
    ruta.fulfill({ json: { consumo: { tareas: 1, costeModelosEuros: 0.0123 } } }),
  );
  await page.route('**/api/perfil', (ruta) =>
    ruta.fulfill({ json: { mostrarPresencia: true, disposicionPanel: [] } }),
  );
  // La sala no existe en este arnés: sin ella el panel sigue por su refresco de respaldo.
  await page.route('**/api/sala/**', (ruta) =>
    ruta.fulfill({ status: 503, json: { error: 'Sala no disponible en la prueba.' } }),
  );
  await page.route('**/api/inicio/encargar', async (ruta) => {
    api.encargar(ruta.request().postDataJSON() as { encargo: string });
    await ruta.fulfill({ status: 202, json: { tareaId: 't-nueva' } });
  });
  await page.route('**/api/inicio/tareas/*', async (ruta) => {
    const id = new URL(ruta.request().url()).pathname.split('/').pop();
    const tarea = api.tarea();
    if (!tarea || tarea.tareaId !== id) {
      await ruta.fulfill({ status: 404, json: { error: 'Esa tarea no existe.' } });
      return;
    }
    await ruta.fulfill({ json: { tarea } });
  });
  await page.route('**/api/inicio/avisos/*/decidir', async (ruta) => {
    const cuerpo = ruta.request().postDataJSON() as { sentido: 'aprobada' | 'rechazada' };
    api.decidir(cuerpo);
    await ruta.fulfill({
      json: { aprobacionId: 'a-nueva', yaEstaba: false, sentido: cuerpo.sentido },
    });
  });
}

test('encargar en el Inicio, abrir el detalle, ver llegar los pasos y aprobar desde el detalle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  const api = crearApiSimulada();
  await montarApi(page, api);
  await page.clock.install();

  // 1. Encargar en el Inicio.
  await page.goto('/panel/inicio?fuenteSimulada=1');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.getByLabel('A quién').selectOption('p-cobros');
  await page
    .getByLabel('Qué necesitas')
    .fill('Revisa las facturas vencidas y prepara la nota de seguimiento.');
  await page.getByRole('button', { name: 'Encargar' }).click();
  await expect(page.getByTestId('saludo-enviado')).toBeVisible();
  await expect.poll(() => api.encargos().length).toBe(1);

  // 2. Abrir el detalle desde «Lo último».
  const enlace = page.getByTestId('lo-ultimo-lista').getByRole('link', {
    name: 'Revisa las facturas vencidas y prepara la nota de seguimiento.',
  });
  await expect(enlace).toBeVisible();
  await enlace.click();
  await expect(page).toHaveURL(/\/panel\/inicio\/tarea\/t-nueva$/);
  await expect(
    page.getByRole('heading', {
      name: 'Revisa las facturas vencidas y prepara la nota de seguimiento.',
    }),
  ).toBeVisible();
  await expect(page.getByTestId('detalle-estado')).toContainText('Pendiente de arrancar');
  await expect(page.getByText('Recibió el encargo')).toBeVisible();
  await expect(page.getByText('Usó «listar_facturas_vencidas»')).toBeHidden();
  await page.screenshot({ path: `${CAPTURAS}/detalle-1-recien-encargada.png`, fullPage: true });

  // 3. Ver llegar los pasos sin recargar: el agente avanza y el panel se actualiza solo.
  api.avanzarHastaLaAprobacion();
  await page.clock.runFor(21_000);
  await expect(page.getByText('Usó «listar_facturas_vencidas»')).toBeVisible();
  await expect(page.getByText('Pidió tu aprobación')).toBeVisible();
  await expect(page.getByTestId('detalle-estado')).toContainText('Esperando tu aprobación');
  await expect(page.getByTestId('detalle-coste')).toContainText('0,0123');

  // 4. Qué va a escribir, antes de aprobar.
  const aprobacion = page.getByTestId('detalle-aprobacion');
  await expect(aprobacion).toContainText(RESUMEN);
  await expect(aprobacion).toContainText('N1 · supervisado');
  await page.screenshot({ path: `${CAPTURAS}/detalle-2-aprobacion-pendiente.png`, fullPage: true });

  // 5. Aprobar desde el detalle, por la misma ruta que el panel de avisos.
  await aprobacion.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByTestId('detalle-aprobacion')).toBeHidden();
  await expect(page.getByText('Se aprobó', { exact: true })).toBeVisible();
  await expect(page.getByTestId('detalle-estado')).toContainText('En curso');
  expect(api.decisiones()).toEqual([{ sentido: 'aprobada' }]);
  await page.screenshot({ path: `${CAPTURAS}/detalle-3-aprobada.png`, fullPage: true });
});

test('el detalle se ve en el móvil con la aprobación primero', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = crearApiSimulada();
  api.encargar({ encargo: 'Revisa las facturas vencidas y prepara la nota de seguimiento.' });
  api.avanzarHastaLaAprobacion();
  await montarApi(page, api);

  await page.goto('/panel/inicio/tarea/t-nueva?fuenteSimulada=1');
  await expect(page.getByTestId('detalle-aprobacion')).toContainText(RESUMEN);
  await expect(page.getByRole('button', { name: 'Aprobar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rechazar' })).toBeVisible();
  await page.screenshot({ path: `${CAPTURAS}/detalle-4-movil.png`, fullPage: true });
});

test('necesita a una persona: si la aprobación es de otra persona, se ve pero no se decide', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  const api = crearApiSimulada();
  api.encargar({ encargo: 'Revisa las facturas vencidas y prepara la nota de seguimiento.' });
  api.soloVer();
  api.avanzarHastaLaAprobacion();
  await montarApi(page, api);

  await page.goto('/panel/inicio/tarea/t-nueva?fuenteSimulada=1');
  await expect(page.getByTestId('detalle-aprobacion-ajena')).toContainText(RESUMEN);
  await expect(page.getByTestId('detalle-aprobacion-ajena')).toContainText('otra persona');
  await expect(page.getByRole('button', { name: 'Aprobar' })).toHaveCount(0);
  await page.screenshot({
    path: `${CAPTURAS}/detalle-5-necesita-a-una-persona.png`,
    fullPage: true,
  });
});

test('estado vacío: una tarea que el agente aún no ha empezado dice que no hay pasos', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  const api = crearApiSimulada();
  api.encargar({ encargo: 'Concilia el extracto de septiembre.' });
  const tarea = api.tarea();
  if (tarea) tarea.pasos = [];
  await montarApi(page, api);

  await page.goto('/panel/inicio/tarea/t-nueva?fuenteSimulada=1');
  await expect(page.getByTestId('detalle-sin-pasos')).toContainText(
    'todavía no ha dado ningún paso',
  );
  await page.screenshot({ path: `${CAPTURAS}/detalle-6-vacio.png`, fullPage: true });
});

test('estado de error: si el detalle no carga, lo dice y deja reintentar', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 700 });
  const api = crearApiSimulada();
  api.encargar({ encargo: 'Concilia el extracto de septiembre.' });
  await montarApi(page, api);
  let caida = true;
  await page.route('**/api/inicio/tareas/*', async (ruta) => {
    if (caida) {
      await ruta.fulfill({ status: 502, json: { error: 'El inicio no responde.' } });
      return;
    }
    await ruta.fallback();
  });

  await page.goto('/panel/inicio/tarea/t-nueva?fuenteSimulada=1');
  await expect(page.getByTestId('detalle-error')).toContainText('No se ha podido cargar la tarea');
  await page.screenshot({ path: `${CAPTURAS}/detalle-7-error.png`, fullPage: true });

  caida = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Concilia el extracto de septiembre.' }),
  ).toBeVisible();
});

test('una tarea de otra organización responde como si no existiera', async ({ page }) => {
  const api = crearApiSimulada();
  await montarApi(page, api);

  await page.goto('/panel/inicio/tarea/t-de-otra-organizacion?fuenteSimulada=1');
  await expect(page.getByTestId('detalle-no-existe')).toContainText('No encontramos esa tarea');
});
