import { expect, test, type Page } from '@playwright/test';

/**
 * Expediente por agente en el panel (docs/specs/expediente-por-agente-n0-n1.md):
 * se llega desde la tarjeta del agente en el Inicio y desde el detalle de la tarea,
 * se ve el nivel por clase de acción con su historial, el avance hacia el ascenso,
 * las lecciones y lo que la política rechazó. Solo lectura.
 *
 * Igual que `e2e/detalle-tarea.spec.ts`, el arnés solo arranca `apps/web`: la API se
 * simula con `page.route`. Todos los datos son de prueba. Las capturas van a
 * `docs/producto/capturas/`.
 */

const CAPTURAS = 'docs/producto/capturas';
const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString();

const EXPEDIENTE = {
  puestoId: 'p-cobros',
  nombre: 'Cobros',
  departamento: 'Finanzas',
  estado: 'activo',
  versionActiva: { versionPuestoId: 'v3', numero: 3 },
  versiones: [
    {
      versionPuestoId: 'v1',
      numero: 1,
      creadaEn: hace(60),
      niveles: { lectura: 'n3', escritura: 'n0', comunicar: 'n1', gastar: 'n0' },
      clasesProhibidas: [],
      lecciones: [],
    },
  ],
  clases: [
    {
      claseAccion: 'comunicar',
      nivel: 'n1',
      prohibida: false,
      ascenso: null,
      sinAscenso: 'fijo',
      historial: [],
    },
    {
      claseAccion: 'escritura',
      nivel: 'n1',
      prohibida: false,
      ascenso: {
        de: 'n1',
        a: 'n2',
        acciones: { actual: 12, requerido: 30, cumplido: false },
        aprobadasSinCambiosPct: { actual: 96.8, requerido: 95, cumplido: true },
        diasSinIncidentes: { actual: 21, requerido: 30, cumplido: false },
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
          fecha: hace(21),
          leccionId: 'l1',
          decididaPorPersonaId: 'persona-1',
        },
      ],
    },
    {
      claseAccion: 'gastar',
      nivel: 'n0',
      prohibida: false,
      ascenso: null,
      sinAscenso: 'sin_criterio',
      historial: [],
    },
    {
      claseAccion: 'lectura',
      nivel: 'n3',
      prohibida: false,
      ascenso: null,
      sinAscenso: 'nivel_maximo',
      historial: [],
    },
  ],
  lecciones: [
    {
      leccionId: 'l1',
      titulo: 'Saluda por el nombre',
      linea: 'Empieza las notas saludando por el nombre de la persona.',
      estado: 'vigente',
      promocionId: 'pr1',
      versionPuestoId: 'v3',
    },
    {
      leccionId: 'l2',
      titulo: 'Firma con el equipo',
      linea: 'Firma las notas como «El equipo de Finanzas».',
      estado: 'propuesta',
      promocionId: null,
      versionPuestoId: null,
    },
  ],
  rechazadas: [
    {
      numeroOrden: 7,
      tareaId: 't-1',
      claseAccion: 'gastar',
      herramienta: 'pagar_factura',
      nivel: 'n0',
      costeEuros: 0,
      porque: 'Gastar es N0 fijo: el agente propone y una persona actúa.',
      creadoEn: hace(2),
    },
  ],
  totalRechazadas: 1,
};

const AGENTES = [
  {
    puestoId: 'p-cobros',
    nombre: 'Cobros',
    estado: 'activo',
    departamentoId: 'd1',
    departamento: 'Finanzas',
    salaId: null,
    origenPlantilla: true,
    tareaEnCurso: null,
    ultimasCompletadas: [],
  },
];

async function montarApi(page: Page, expediente: () => { estado: number; cuerpo: unknown }) {
  await page.route('**/api/inicio/agentes', (r) => r.fulfill({ json: { agentes: AGENTES } }));
  await page.route('**/api/inicio/avisos', (r) => r.fulfill({ json: { avisos: [] } }));
  await page.route('**/api/contador', (r) =>
    r.fulfill({ json: { consumo: { tareas: 1, costeModelosEuros: 0.0123 } } }),
  );
  await page.route('**/api/perfil', (r) =>
    r.fulfill({ json: { mostrarPresencia: true, disposicionPanel: [] } }),
  );
  await page.route('**/api/sala/**', (r) =>
    r.fulfill({ status: 503, json: { error: 'Sala no disponible en la prueba.' } }),
  );
  await page.route('**/api/puestos/*/expediente', (r) => {
    const { estado, cuerpo } = expediente();
    return r.fulfill({ status: estado, json: cuerpo });
  });
}

test('desde la tarjeta del agente se abre el expediente: niveles, ascenso, lecciones y rechazadas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await montarApi(page, () => ({ estado: 200, cuerpo: { expediente: EXPEDIENTE } }));

  await page.goto('/panel/inicio?fuenteSimulada=1');
  await page.getByRole('link', { name: 'Expediente de Cobros' }).click();
  await expect(page).toHaveURL(/\/panel\/inicio\/agente\/p-cobros\/expediente$/);
  await expect(page.getByRole('heading', { name: 'Cobros', level: 1 })).toBeVisible();
  await expect(page.getByTestId('expediente-version')).toContainText('3');

  // Una clase N1 con sus cuatro criterios.
  const ascenso = page.getByTestId('ascenso-escritura');
  await expect(ascenso).toContainText('1 de 4 criterios cumplidos');
  await expect(ascenso.getByRole('meter')).toHaveCount(4);
  await expect(page.getByTestId('criterio-escritura-acciones')).toContainText('12 de 30');
  await expect(page.getByTestId('criterio-escritura-aprobadas')).toContainText('96,8 %');
  await expect(page.getByTestId('historial-escritura')).toContainText(
    'Subió de N0 · manual a N1 · supervisado',
  );

  // Una clase fija no enseña barra.
  await expect(page.getByTestId('sin-ascenso-comunicar')).toContainText('Fijo en N1');
  await expect(page.getByTestId('clase-comunicar').getByRole('meter')).toHaveCount(0);

  // Lecciones y rechazadas con su porqué y su enlace a la tarea.
  await expect(page.getByTestId('lecciones')).toContainText('Vigente');
  await expect(page.getByTestId('rechazadas')).toContainText('«pagar_factura»');
  await page.getByRole('button', { name: /Por qué lo hice/ }).click();
  await expect(page.getByTestId('rechazadas')).toContainText('Gastar es N0 fijo');
  await expect(page.getByRole('link', { name: 'Ver en la tarea' })).toHaveAttribute(
    'href',
    '/panel/inicio/tarea/t-1#paso-7',
  );

  // Solo lectura: ningún botón de escritura ni formulario.
  await expect(page.locator('form, input, select, textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /subir|bajar|promocionar|aprobar/i })).toHaveCount(
    0,
  );

  await page.screenshot({ path: `${CAPTURAS}/expediente-1-escritorio.png`, fullPage: true });
});

test('el expediente se ve en el móvil sin desbordar la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await montarApi(page, () => ({ estado: 200, cuerpo: { expediente: EXPEDIENTE } }));
  await page.goto('/panel/inicio/agente/p-cobros/expediente?fuenteSimulada=1');
  await expect(page.getByTestId('ascenso-escritura')).toBeVisible();
  const desborda = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(desborda).toBe(false);
  await page.screenshot({ path: `${CAPTURAS}/expediente-2-movil.png`, fullPage: true });
});

test('estado vacío: sin lecciones ni rechazadas lo dice', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await montarApi(page, () => ({
    estado: 200,
    cuerpo: {
      expediente: {
        ...EXPEDIENTE,
        versiones: [{ ...EXPEDIENTE.versiones[0], numero: 1 }],
        versionActiva: { versionPuestoId: 'v1', numero: 1 },
        clases: EXPEDIENTE.clases.map((c) => ({ ...c, historial: [] })),
        lecciones: [],
        rechazadas: [],
        totalRechazadas: 0,
      },
    },
  }));
  await page.goto('/panel/inicio/agente/p-cobros/expediente?fuenteSimulada=1');
  await expect(page.getByTestId('lecciones-vacio')).toContainText('Todavía no ha aprendido nada');
  await expect(page.getByTestId('rechazadas-vacio')).toContainText('ninguna acción');
  await page.screenshot({ path: `${CAPTURAS}/expediente-3-vacio.png`, fullPage: true });
});

test('estado de error: si no carga, lo dice y reintenta', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  let fallos = 1;
  await montarApi(page, () =>
    fallos-- > 0
      ? { estado: 502, cuerpo: { error: 'El inicio no responde.' } }
      : { estado: 200, cuerpo: { expediente: EXPEDIENTE } },
  );
  await page.goto('/panel/inicio/agente/p-cobros/expediente?fuenteSimulada=1');
  await expect(page.getByTestId('expediente-error')).toContainText('No se ha podido cargar');
  await page.screenshot({ path: `${CAPTURAS}/expediente-4-error.png`, fullPage: true });
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('heading', { name: 'Cobros', level: 1 })).toBeVisible();
});

test('un agente que no existe o es de otra organización se dice sin más detalle', async ({
  page,
}) => {
  await montarApi(page, () => ({ estado: 404, cuerpo: { error: 'Ese puesto no existe.' } }));
  await page.goto('/panel/inicio/agente/p-ajeno/expediente?fuenteSimulada=1');
  await expect(page.getByTestId('expediente-no-existe')).toContainText('No encontramos ese agente');
});
