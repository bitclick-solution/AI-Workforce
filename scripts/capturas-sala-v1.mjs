/**
 * Capturas de Sala v1 para el PR: S2 (escritorio) y S4 (móvil), en claro y en
 * oscuro, con la fuente simulada. Necesita el web arrancado con `AIW_SALA_V1=1`:
 *
 *   AIW_SALA_V1=1 pnpm --filter @aiw/web start --port 3100
 *   node scripts/capturas-sala-v1.mjs [carpeta]
 *
 * `PW_CHROMIUM_PATH` permite usar un Chromium ya instalado, como en la e2e.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const base = process.env['AIW_WEB_URL'] ?? 'http://127.0.0.1:3100';
const carpeta = process.argv[2] ?? 'docs/specs/capturas/sala-v1-interfaz';
const ejecutable = process.env['PW_CHROMIUM_PATH'];

await mkdir(carpeta, { recursive: true });
const navegador = await chromium.launch(ejecutable ? { executablePath: ejecutable } : {});

const casos = [
  { nombre: 'escritorio', viewport: { width: 1440, height: 1000 }, movil: false },
  { nombre: 'movil', viewport: { width: 390, height: 844 }, movil: true },
];

for (const modo of ['light', 'dark']) {
  const sufijo = modo === 'light' ? 'claro' : 'oscuro';
  for (const caso of casos) {
    const contexto = await navegador.newContext({
      viewport: caso.viewport,
      colorScheme: modo,
      reducedMotion: 'reduce',
      deviceScaleFactor: caso.movil ? 2 : 1,
      hasTouch: caso.movil,
      isMobile: caso.movil,
    });
    const pagina = await contexto.newPage();
    await pagina.goto(`${base}/panel/sala?sala=finanzas`);
    await pagina
      .getByTestId('indicador-de-escritura')
      .getByText(/escribiendo/)
      .waitFor();
    await pagina.screenshot({ path: join(carpeta, `${caso.nombre}-${sufijo}.png`) });
    if (caso.movil) {
      await pagina.getByTestId('fila-de-presencia').click();
      await pagina.getByRole('dialog').waitFor();
      await pagina.screenshot({ path: join(carpeta, `${caso.nombre}-miembros-${sufijo}.png`) });
      await pagina.keyboard.press('Escape');
      await pagina.getByTestId('abrir-salas').click();
      await pagina.getByRole('dialog').waitFor();
      await pagina.screenshot({ path: join(carpeta, `${caso.nombre}-salas-${sufijo}.png`) });
    }
    await contexto.close();
  }
}

await navegador.close();
console.log(`Capturas en ${carpeta}`);
