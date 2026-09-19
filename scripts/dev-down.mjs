#!/usr/bin/env node
// Para el entorno de desarrollo. Conserva los volúmenes salvo que se pase `--volumes`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaEnv = join(raiz, '.env');
if (!existsSync(rutaEnv)) {
  console.error('No existe .env; nada que parar. Ejecuta `pnpm dev:up` primero.');
  process.exit(1);
}
const resultado = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    rutaEnv,
    '-f',
    join(raiz, 'deploy/compose/docker-compose.dev.yml'),
    'down',
    ...process.argv.slice(2),
  ],
  { cwd: raiz, stdio: 'inherit' },
);
process.exit(resultado.status ?? 1);
