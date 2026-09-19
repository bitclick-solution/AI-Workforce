import { expect, test } from '@playwright/test';

test('la página de inicio muestra el nombre del producto', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'AI Workforce' })).toBeVisible();
});

test('la página de inicio expone el estado de los cimientos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('estado-cimientos')).toContainText('Cimientos');
});
