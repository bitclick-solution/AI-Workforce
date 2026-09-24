import { expect, test, type Page } from '@playwright/test';

/**
 * Prueba de humo del prototipo: los tres flujos hasta ver el tiempo medido, los
 * estados que no son el camino feliz, y la aprobación en pantalla de móvil.
 *
 * El recorrido se navega siempre con clics dentro de la aplicación: el estado
 * vive en memoria del navegador y recargar la página lo reinicia a propósito.
 */

async function recorrerHastaAprobar(page: Page) {
  await page.goto('/prototipo');
  await page.getByTestId('empezar').click();

  await expect(
    page.getByRole('heading', { level: 1, name: /Contrata escribiendo una frase/ }),
  ).toBeVisible();
  await expect(page.getByTestId('estado-vacio')).toBeVisible();
  await page.getByTestId('ejemplo-0').click();
  await expect(page.getByTestId('propuesta')).toBeVisible();
  await expect(page.getByTestId('propuesta')).toContainText('Conciliación bancaria');
  await expect(page.getByTestId('propuesta')).toContainText('50 € al mes');
  await page.getByTestId('contratar').click();

  await expect(page.getByRole('heading', { level: 1, name: 'Sala general' })).toBeVisible();
  await expect(page.getByTestId('estado-vacio')).toBeVisible();
  await page.getByTestId('preguntar').click();
  await expect(page.getByTestId('intervencion')).toBeVisible();
  await expect(page.getByTestId('moderador')).toContainText('moderador');
  await expect(page.getByTestId('intervencion')).toContainText('Nivel');
  await page.getByTestId('ir-a-aprobar').click();

  await expect(page.getByTestId('peticion')).toBeVisible();
}

test('el recorrido completo llega a la primera tarea aprobada con el tiempo medido', async ({
  page,
}) => {
  await recorrerHastaAprobar(page);

  await page.getByTestId('aprobar').click();
  await expect(page.getByTestId('aprobada')).toBeVisible();

  await page.getByTestId('ir-a-resumen').click();
  await expect(page.getByTestId('tiempo-medido')).toBeVisible();
  await expect(page.getByTestId('tiempo-medido')).toContainText(/\d+ s/);
  await expect(page.getByTestId('contador')).toContainText('1 de 1500');
});

test('editar el borrador antes de aprobar deja constancia de la edición', async ({ page }) => {
  await recorrerHastaAprobar(page);

  await page.getByTestId('editar').click();
  await page.getByTestId('campo-borrador').fill('Llamé yo al cliente. Paga el jueves.');
  await page.getByTestId('aprobar').click();

  await expect(page.getByTestId('aprobada')).toBeVisible();
  await expect(page.getByTestId('hubo-edicion')).toBeVisible();
});

test('la contratación ofrece su estado vacío, el de error y el de necesita a una persona', async ({
  page,
}) => {
  await page.goto('/prototipo/contratacion');
  await expect(page.getByTestId('estado-vacio')).toBeVisible();

  await page.getByTestId('ejemplo-1').click();
  await expect(page.getByTestId('estado-error')).toBeVisible();
  await expect(page.getByTestId('estado-error')).toContainText('No tengo ningún puesto');

  await page.getByTestId('ejemplo-2').click();
  await expect(page.getByTestId('estado-necesita-persona')).toBeVisible();
  await expect(page.getByTestId('estado-necesita-persona')).toContainText('riesgo crítico');
});

test('la sala ofrece su estado vacío, el de error y el de necesita a una persona', async ({
  page,
}) => {
  await page.goto('/prototipo/sala');
  await expect(page.getByTestId('estado-vacio')).toBeVisible();

  await page.getByTestId('preguntar-error').click();
  await expect(page.getByTestId('estado-error')).toBeVisible();
  await expect(page.getByTestId('estado-error')).toContainText('No he podido leer el banco');

  await page.getByTestId('preguntar-persona').click();
  await expect(page.getByTestId('estado-necesita-persona')).toBeVisible();
  await expect(page.getByTestId('estado-necesita-persona')).toContainText('disputa');
});

test('la aprobación ofrece rechazar, caducar y el error del texto vacío', async ({ page }) => {
  await page.goto('/prototipo/aprobacion');

  await page.getByTestId('ver-caducada').click();
  await expect(page.getByTestId('estado-vacio')).toContainText('48 horas');
  await page.getByRole('button', { name: 'Volver a la petición' }).click();

  await page.getByTestId('editar').click();
  await page.getByTestId('campo-borrador').fill('   ');
  await page.getByTestId('aprobar').click();
  await expect(page.getByTestId('estado-error')).toContainText('no puede quedar vacía');
  await page.getByRole('button', { name: 'Recuperar el texto original' }).click();

  await page.getByTestId('rechazar').click();
  await expect(page.getByTestId('estado-necesita-persona')).toContainText('No he escrito nada');
});

test.describe('en pantalla de móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la aprobación se lee y se decide sin desplazamiento horizontal', async ({ page }) => {
    await page.goto('/prototipo/aprobacion');
    await expect(page.getByTestId('peticion')).toBeVisible();

    const desbordado = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(desbordado).toBe(false);

    await expect(page.getByTestId('aprobar')).toBeVisible();
    await page.getByTestId('aprobar').click();
    await expect(page.getByTestId('aprobada')).toBeVisible();
  });
});
