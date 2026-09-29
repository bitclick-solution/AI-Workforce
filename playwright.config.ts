import { defineConfig, devices } from '@playwright/test';

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Permite reutilizar un Chromium ya instalado (entornos sin acceso a la CDN de Playwright).
        ...(process.env['PW_CHROMIUM_PATH']
          ? { launchOptions: { executablePath: process.env['PW_CHROMIUM_PATH'] } }
          : {}),
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @aiw/web start --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    // Sala v1 sin API ni datos reales (e2e/sala-v1.spec.ts): la vista pide la
    // simulada explícitamente con `?fuenteSimulada=1` (lib/sala-fuente.ts).
    env: { AIW_SALA_V1: '1' },
  },
});
