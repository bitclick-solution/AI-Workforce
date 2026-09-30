import { expect, test, type Page } from '@playwright/test';

/**
 * Inicio (ADR-020, docs/specs/inicio-panel-widgets-avisos.md): panel de widgets,
 * agentes y avisos.
 *
 * Esta prueba interceptas las peticiones a `/api/inicio/**`, `/api/perfil` y
 * `/api/contador` con `page.route`: el arnés de Playwright de este repo
 * (`playwright.config.ts`) solo arranca `apps/web`, no `apps/api`, PostgreSQL ni
 * Temporal, y esta sesión no tiene Docker disponible para levantarlos. No es la
 * prueba de extremo a extremo contra los puestos de Cobros y Conciliación
 * sembrados de verdad que pide el criterio de hecho 8 — esa necesita ese arnés
 * ampliado, que es trabajo de infraestructura de pruebas más allá de esta
 * rebanada—, pero ejercita el mismo flujo (encargar, verlo llegar, aprobar en
 * línea) y el teclado (criterio de hecho 9) contra la interfaz real.
 */

const AGENTE_COBROS = {
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

const AGENTE_CONCILIACION = {
  puestoId: 'p-conciliacion',
  nombre: 'Conciliación',
  estado: 'en_prueba',
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

async function abrirInicio(page: Page) {
  let agentes = [AGENTE_COBROS, AGENTE_CONCILIACION];
  let avisos = [AVISO];
  let encargado: unknown;
  let decidido: unknown;

  await page.route('**/api/inicio/agentes', async (route) => {
    await route.fulfill({ json: { agentes } });
  });
  await page.route('**/api/inicio/avisos', async (route) => {
    await route.fulfill({ json: { avisos } });
  });
  await page.route('**/api/contador', async (route) => {
    await route.fulfill({ json: { consumo: { tareas: 3, costeModelosEuros: 0.42 } } });
  });
  await page.route('**/api/perfil', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { mostrarPresencia: true, disposicionPanel: [] } });
      return;
    }
    await route.fulfill({ json: { mostrarPresencia: true, disposicionPanel: [] } });
  });
  await page.route('**/api/inicio/encargar', async (route) => {
    encargado = route.request().postDataJSON();
    // Simula que el encargo ya aparece «en curso» en la siguiente lectura, como
    // haría la API real tras crear la tarea raíz (criterio de hecho 3).
    agentes = [
      {
        ...AGENTE_COBROS,
        tareaEnCurso: {
          tareaId: 't-nueva',
          encargo: 'Revisa las facturas vencidas de hoy.',
          estado: 'en_curso',
          desde: new Date().toISOString(),
        },
      },
      AGENTE_CONCILIACION,
    ];
    await route.fulfill({ json: { tareaId: 't-nueva' }, status: 202 });
  });
  await page.route('**/api/inicio/avisos/*/decidir', async (route) => {
    decidido = route.request().postDataJSON();
    avisos = [];
    await route.fulfill({ json: { aprobacionId: 'a1', yaEstaba: false, sentido: 'aprobada' } });
  });

  // `fuenteSimulada=1`: el respaldo de Sala v1 no habla con una API real (lib/sala-fuente.ts).
  await page.goto('/panel/inicio?fuenteSimulada=1');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();

  return {
    encargoEnviado: () => encargado,
    decisionEnviada: () => decidido,
  };
}

test('encargar, verlo llegar en «lo último» y aprobar un aviso en línea', async ({ page }) => {
  const { encargoEnviado, decisionEnviada } = await abrirInicio(page);

  await expect(page.getByText('Enviar la nota de seguimiento a Contoso.')).toBeVisible();

  await page.getByLabel('A quién').selectOption('p-cobros');
  await page.getByLabel('Qué necesitas').fill('Revisa las facturas vencidas de hoy.');
  await page.getByRole('button', { name: 'Encargar' }).click();

  await expect(page.getByTestId('saludo-enviado')).toBeVisible();
  await expect
    .poll(() => encargoEnviado())
    .toEqual({ puestoId: 'p-cobros', encargo: 'Revisa las facturas vencidas de hoy.' });

  // Verlo llegar: «Lo último» refleja la tarea recién arrancada sin recargar la página.
  await expect(page.getByTestId('lo-ultimo-lista')).toContainText('Revisa las facturas vencidas de hoy.');

  // Aprobar en línea: desaparece de los avisos y la decisión lleva el sentido correcto.
  await page.getByRole('button', { name: 'Aprobar' }).click();
  await expect(page.getByText('Enviar la nota de seguimiento a Contoso.')).toBeHidden();
  await expect.poll(() => decisionEnviada()).toEqual({ sentido: 'aprobada' });
  await expect(page.getByText('No hay avisos pendientes.')).toBeVisible();
});

test('el panel se reordena por teclado, sin ratón (criterio de hecho 9)', async ({ page }) => {
  await abrirInicio(page);

  const panel = page.getByTestId('inicio-panel-de-widgets');
  const tituloDe = (indice: number) => panel.locator('h3').nth(indice).textContent();

  await expect(panel.locator('h3').first()).toHaveText('Saludo');
  expect(await tituloDe(1)).toBe('Contador del periodo');

  const subirContador = page.getByRole('button', { name: 'Subir «Contador del periodo»' });
  await subirContador.focus();
  await expect(subirContador).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(panel.locator('h3').first()).toHaveText('Contador del periodo');
  expect(await tituloDe(1)).toBe('Saludo');
});

test('sin ningún agente, el saludo lo dice y no rompe el resto del panel', async ({ page }) => {
  await page.route('**/api/inicio/agentes', async (route) => {
    await route.fulfill({ json: { agentes: [] } });
  });
  await page.route('**/api/inicio/avisos', async (route) => {
    await route.fulfill({ json: { avisos: [] } });
  });
  await page.route('**/api/contador', async (route) => {
    await route.fulfill({ json: { consumo: { tareas: 0, costeModelosEuros: 0 } } });
  });
  await page.route('**/api/perfil', async (route) => {
    await route.fulfill({ json: { mostrarPresencia: true, disposicionPanel: [] } });
  });

  await page.goto('/panel/inicio?fuenteSimulada=1');
  await expect(page.getByTestId('saludo-sin-agentes')).toBeVisible();
  await expect(page.getByTestId('equipo-vacio')).toBeVisible();
  await expect(page.getByTestId('vencido-vacio')).toBeVisible();
  await expect(page.getByTestId('lo-ultimo-vacio')).toBeVisible();
  await expect(page.getByText('No hay avisos pendientes.')).toBeVisible();
});
