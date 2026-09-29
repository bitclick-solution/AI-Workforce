#!/usr/bin/env node
// `pnpm local:a-cero`: para todo y borra los volúmenes del Compose (PostgreSQL,
// Silo, Redis, ClickHouse) tras confirmación. `.env` no se toca: la próxima
// `pnpm local:arrancar` reutiliza los mismos secretos locales.
// No interactivo (CI): `pnpm local:a-cero -- --si`.
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  composeArgs,
  confirmar,
  pararProcesosRegistrados,
  raiz,
  raizLocal,
} from './local-comun.mjs';

const argumentos = process.argv.slice(2);

const confirmado = await confirmar(
  'Esto borra todos los datos locales (PostgreSQL, Silo, Redis, ClickHouse). ¿Seguro?',
  argumentos,
);
if (!confirmado) {
  console.error('Cancelado: nada se ha borrado.');
  process.exit(1);
}

console.log('— Parando api, web y el worker de la demo');
pararProcesosRegistrados();

console.log('— Parando el Compose y borrando volúmenes');
const resultado = spawnSync('docker', [...composeArgs, 'down', '--volumes'], {
  cwd: raiz,
  stdio: 'inherit',
});
if (resultado.status !== 0) process.exit(resultado.status ?? 1);

if (existsSync(raizLocal)) {
  rmSync(raizLocal, { recursive: true, force: true });
  console.log('— Borrados los registros locales (.aiw-local/)');
}

console.log('\nVuelto a cero. `pnpm local:arrancar` arranca de nuevo desde vacío.');
