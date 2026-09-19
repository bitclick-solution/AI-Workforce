#!/usr/bin/env node
// Para el entorno de desarrollo. Conserva los volúmenes salvo que se pase `--volumes`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { composeArgs, migrarEnv, raiz, rutaEnv } from './env-local.mjs';

if (!existsSync(rutaEnv)) {
  console.error('No existe .env; nada que parar. Ejecuta `pnpm dev:up` primero.');
  process.exit(1);
}
migrarEnv();
const resultado = spawnSync('docker', [...composeArgs, 'down', ...process.argv.slice(2)], {
  cwd: raiz,
  stdio: 'inherit',
});
process.exit(resultado.status ?? 1);
