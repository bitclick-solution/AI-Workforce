import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Sala v1 (ADR-022) con la fuente simulada: S2 en escritorio y S4 en el móvil.
 * El servidor de pruebas arranca con `AIW_SALA_V1=1` (playwright.config.ts).
 */

const ESTADOS = [
  'En la sala',
  'Escribiendo…',
  'Trabajando',
  'Te necesita',
  'Inactivo',
  'Añadido',
  'En pausa',
];

async function abrirSala(page: Page, sala = 'finanzas') {
  await page.goto(`/panel/sala?sala=${sala}`);
  await expect(page.getByTestId('sala-v1')).toBeVisible();
}

async function altura(elemento: Locator): Promise<number> {
  const caja = await elemento.boundingBox();
  if (!caja) throw new Error('El elemento no está a la vista');
  return Math.min(caja.height, caja.width);
}

test.describe('escritorio · S2', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('salas en la navegación, conversación y miembros con los siete estados en texto', async ({
    page,
  }) => {
    await abrirSala(page);

    const navegacion = page.getByRole('navigation', { name: 'Salas' }).first();
    await expect(navegacion.getByRole('link', { name: /finanzas/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      navegacion.getByRole('link', { name: /2 menciones, 4 mensajes sin leer/ }),
    ).toBeVisible();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('finanzas');
    await expect(page.getByTestId('resumen-escritorio')).toContainText('en la sala');
    await expect(page.getByTestId('tarjeta-aprobacion')).toBeVisible();
    await expect(page.getByTestId('tarjeta-propuesta')).toBeVisible();
    await expect(page.getByText('IA', { exact: true }).first()).toBeVisible();

    const panel = page.getByTestId('miembros-escritorio');
    await expect(panel.getByRole('heading', { name: /Personas · \d/ })).toBeVisible();
    await expect(panel.getByRole('heading', { name: /Agentes · \d/ })).toBeVisible();
    for (const estado of ESTADOS) {
      await expect(panel.getByText(estado).first()).toBeVisible();
    }
  });

  test('el indicador de escritura se anuncia con aria-live', async ({ page }) => {
    await abrirSala(page);
    const indicador = page.getByTestId('indicador-de-escritura');
    await expect(indicador).toHaveAttribute('aria-live', 'polite');
    await expect(indicador).toContainText('Director de IA está escribiendo…');
  });

  test('los filtros cambian la lista y el panel se oculta y vuelve', async ({ page }) => {
    await abrirSala(page);
    const panel = page.getByTestId('miembros-escritorio');

    await panel.getByTestId('filtro-anadidos').click();
    await expect(panel.getByTestId('filtro-anadidos')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText('Asesoría Olmo')).toBeVisible();
    await expect(panel.getByText('Cobros')).toHaveCount(0);

    await panel.getByTestId('filtro-inactivos').click();
    await expect(panel.getByText('Tomás Rivel')).toBeVisible();
    await expect(panel.getByText('Previsión')).toBeVisible();

    await page.getByTestId('ocultar-miembros').click();
    await expect(page.getByTestId('panel-de-miembros')).toHaveCount(0);
    await expect(page.getByTestId('alternar-miembros')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('alternar-miembros').click();
    await expect(page.getByTestId('panel-de-miembros')).toBeVisible();
  });

  test('se usa con teclado: la primera tabulación entra en las salas y Enter cambia de sala', async ({
    page,
  }) => {
    await abrirSala(page);
    await expect(page.getByTestId('miembros-escritorio')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sala-general').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('sala-ventas-y-atencion').first()).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('ventas-y-atención');
    await expect(page).toHaveURL(/sala=ventas-y-atencion/);
    await expect(page.getByTestId('sala-ventas-y-atencion').first()).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('una sala sin mensajes explica el vacío y ofrece escribir', async ({ page }) => {
    await abrirSala(page, 'marketing');
    await expect(page.getByText('Todavía no hay mensajes en #marketing')).toBeVisible();
    await page.getByRole('button', { name: 'Escribir el primero' }).click();
    await expect(page.getByLabel('Mensaje para #marketing')).toBeFocused();
  });
});

test.describe('móvil · S4', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('fila de presencia, hoja de miembros y cajón de salas con objetivos de 44 px', async ({
    page,
  }) => {
    await abrirSala(page);

    await expect(page.getByTestId('resumen-movil')).toContainText('en la sala');
    await expect(page.getByTestId('panel-de-miembros')).toHaveCount(0);
    for (const control of ['abrir-salas', 'abrir-miembros', 'fila-de-presencia']) {
      expect(await altura(page.getByTestId(control))).toBeGreaterThanOrEqual(44);
    }

    await page.getByTestId('fila-de-presencia').click();
    const hoja = page.getByRole('dialog', { name: /Miembros/ });
    await expect(hoja).toBeVisible();
    for (const estado of ESTADOS) {
      await expect(hoja.getByText(estado).first()).toBeVisible();
    }
    await expect(hoja.getByRole('heading', { name: /En la sala · \d/ })).toBeVisible();
    expect(await altura(hoja.getByTestId('cerrar-hoja'))).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(page.getByTestId('fila-de-presencia')).toBeFocused();

    await page.getByTestId('abrir-salas').click();
    const cajon = page.getByRole('dialog', { name: 'Salas' });
    await expect(cajon).toBeVisible();
    const enlace = cajon.getByTestId('sala-general');
    expect(await altura(enlace)).toBeGreaterThanOrEqual(44);
    await enlace.click();
    await expect(cajon).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('general');
  });
});
