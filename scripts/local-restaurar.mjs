#!/usr/bin/env node
// `pnpm local:restaurar`: restaura una copia hecha con `pnpm local:copia`, con
// `pg_restore --clean` dentro del contenedor. Sobrescribe la base actual: pide
// confirmación, igual que `local:a-cero`.
// Uso: `pnpm local:restaurar -- [ruta-del-dump]` (por defecto, la copia más reciente
// de .aiw-local/copias/) · `pnpm local:restaurar -- <ruta> --si` (no interactivo).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { composeArgs, confirmar, leerEnv, raiz, rutaCopias, rutaEnv } from './local-comun.mjs';

const argumentos = process.argv.slice(2);
const rutaPedida = argumentos.find((a) => !a.startsWith('--'));

function copiaMasReciente() {
  if (!existsSync(rutaCopias)) return undefined;
  const ficheros = readdirSync(rutaCopias)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => ({ f, mtime: statSync(join(rutaCopias, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return ficheros[0] ? join(rutaCopias, ficheros[0].f) : undefined;
}

const rutaDump = rutaPedida || copiaMasReciente();
if (!rutaDump || !existsSync(rutaDump)) {
  console.error('No hay copia que restaurar. Indica la ruta: pnpm local:restaurar -- <ruta>');
  process.exit(1);
}

const confirmado = await confirmar(
  `Esto sustituye la base actual por «${rutaDump}». ¿Seguro?`,
  argumentos,
);
if (!confirmado) {
  console.error('Cancelado: la base no se ha tocado.');
  process.exit(1);
}

const env = leerEnv(rutaEnv);
const usuario = env.POSTGRES_USER || 'postgres';

console.log(`— Restaurando ${rutaDump}`);
const resultado = spawnSync(
  'docker',
  [
    ...composeArgs,
    'exec',
    '-T',
    'postgres',
    'pg_restore',
    '-U',
    usuario,
    '-d',
    'aiworkforce',
    '--clean',
    '--if-exists',
  ],
  { cwd: raiz, input: readFileSync(rutaDump), stdio: ['pipe', 'inherit', 'inherit'] },
);
if (resultado.status !== 0) {
  console.error('pg_restore ha fallado.');
  process.exit(resultado.status ?? 1);
}
console.log('Restaurada.');
