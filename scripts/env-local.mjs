// Utilidades del entorno local: crea .env desde .env.example y migra nombres de variables antiguos.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
export const rutaEnv = join(raiz, '.env');
export const rutaEjemplo = join(raiz, '.env.example');
export const composeArgs = [
  'compose',
  '--env-file',
  rutaEnv,
  '-f',
  join(raiz, 'deploy/compose/docker-compose.dev.yml'),
];

// Nombres anteriores a la migración de MinIO a Silo (ADR-012) y su equivalente actual.
const RENOMBRES = [
  ['MINIO_ROOT_USER', 'S3_ROOT_USER'],
  ['MINIO_ROOT_PASSWORD', 'S3_ROOT_PASSWORD'],
  ['MINIO_PORT', 'S3_PORT'],
  ['MINIO_CONSOLE_PORT', 'S3_CONSOLE_PORT'],
];

/** Devuelve las variables de un fichero .env como objeto, sin interpretar comillas ni interpolación. */
export function leerEnv(ruta = rutaEnv) {
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split('\n')
      .filter((linea) => linea.includes('=') && !linea.trimStart().startsWith('#'))
      .map((linea) => {
        const indice = linea.indexOf('=');
        return [linea.slice(0, indice).trim(), linea.slice(indice + 1)];
      }),
  );
}

/** Sustituye cada GENERAR por un secreto aleatorio local. */
function generar(texto) {
  return texto.replaceAll('GENERAR', () => randomBytes(32).toString('hex'));
}

/** Nombre de la variable de una línea `NOMBRE=valor`. */
function nombreDe(linea) {
  return linea.slice(0, linea.indexOf('=')).trim();
}

/** Crea .env con secretos aleatorios si no existe. Devuelve true si lo ha creado. */
export function asegurarEnv() {
  if (existsSync(rutaEnv)) return false;
  writeFileSync(rutaEnv, generar(readFileSync(rutaEjemplo, 'utf8')), { mode: 0o600 });
  return true;
}

/**
 * Añade a un .env existente las variables de .env.example que le falten, con un
 * secreto aleatorio donde el ejemplo dice GENERAR. No toca las que ya están: un .env
 * creado antes de que una rebanada añadiera variables se completa sin perder nada.
 * Va después de `migrarEnv`, para no generar de nuevo las S3_* que se copian de
 * MINIO_*. Devuelve los nombres añadidos, nunca los valores.
 */
export function completarEnv() {
  const actuales = leerEnv();
  const faltan = readFileSync(rutaEjemplo, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(linea))
    .filter((linea) => !Object.hasOwn(actuales, nombreDe(linea)));
  if (faltan.length === 0) return [];
  const bloque = [
    '',
    '# Añadido por pnpm dev:up: variables nuevas de .env.example.',
    ...faltan.map(generar),
    '',
  ].join('\n');
  writeFileSync(rutaEnv, readFileSync(rutaEnv, 'utf8').replace(/\r?\n?$/, '\n') + bloque, {
    mode: 0o600,
  });
  return faltan.map(nombreDe);
}

/** Añade las variables S3_* a un .env que solo tenga los nombres MINIO_* anteriores. Devuelve las añadidas. */
export function migrarEnv() {
  const env = leerEnv();
  const nuevas = RENOMBRES.filter(([viejo, nuevo]) => viejo in env && !(nuevo in env));
  if (nuevas.length === 0) return [];
  const bloque = [
    '',
    '# Añadido por pnpm dev:up: nombres actuales de las variables del almacén S3 (ADR-012).',
    ...nuevas.map(([viejo, nuevo]) => `${nuevo}=${env[viejo]}`),
    '',
  ].join('\n');
  writeFileSync(rutaEnv, readFileSync(rutaEnv, 'utf8').replace(/\n?$/, '\n') + bloque, {
    mode: 0o600,
  });
  return nuevas.map(([, nuevo]) => nuevo);
}
