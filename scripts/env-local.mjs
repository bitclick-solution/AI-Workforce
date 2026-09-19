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

/** Crea .env con secretos aleatorios si no existe. Devuelve true si lo ha creado. */
export function asegurarEnv() {
  if (existsSync(rutaEnv)) return false;
  const ejemplo = readFileSync(rutaEjemplo, 'utf8');
  const generado = ejemplo.replaceAll('GENERAR', () => randomBytes(32).toString('hex'));
  writeFileSync(rutaEnv, generado, { mode: 0o600 });
  return true;
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
