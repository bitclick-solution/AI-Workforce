#!/usr/bin/env node
// Arranca el entorno de desarrollo con un solo comando.
// 1. Si no existe .env, lo crea desde .env.example con secretos aleatorios locales.
// 2. Ejecuta `docker compose up -d --wait` sobre deploy/compose/docker-compose.dev.yml.
// Uso: `pnpm dev:up` · `pnpm dev:up --solo-env` (solo genera .env) · argumentos extra van a docker compose.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const rutaEnv = join(raiz, '.env');
const rutaEjemplo = join(raiz, '.env.example');
const compose = [
  'compose',
  '--env-file',
  rutaEnv,
  '-f',
  join(raiz, 'deploy/compose/docker-compose.dev.yml'),
];

const argumentos = process.argv.slice(2);
const soloEnv = argumentos.includes('--solo-env');
const extra = argumentos.filter((a) => a !== '--solo-env');

if (!existsSync(rutaEnv)) {
  const ejemplo = readFileSync(rutaEjemplo, 'utf8');
  const generado = ejemplo.replaceAll('GENERAR', () => randomBytes(32).toString('hex'));
  writeFileSync(rutaEnv, generado, { mode: 0o600 });
  console.log('Creado .env con secretos aleatorios de desarrollo. No lo versiones.');
} else {
  console.log('Reutilizando .env existente.');
}

if (soloEnv) process.exit(0);

const resultado = spawnSync('docker', [...compose, 'up', '-d', '--wait', ...extra], {
  cwd: raiz,
  stdio: 'inherit',
});

if (resultado.error) {
  console.error(`No se pudo ejecutar docker: ${resultado.error.message}`);
  process.exit(1);
}
if (resultado.status !== 0) process.exit(resultado.status ?? 1);

const env = Object.fromEntries(
  readFileSync(rutaEnv, 'utf8')
    .split('\n')
    .filter((linea) => linea.includes('=') && !linea.startsWith('#'))
    .map((linea) => {
      const indice = linea.indexOf('=');
      return [linea.slice(0, indice), linea.slice(indice + 1)];
    }),
);
const puerto = (clave, porDefecto) => env[clave] || porDefecto;

console.log(`
Entorno de desarrollo arrancado:
  PostgreSQL        localhost:${puerto('POSTGRES_PORT', '5432')}  (bases aiworkforce, langfuse, temporal)
  Temporal          localhost:${puerto('TEMPORAL_PORT', '7233')}
  Temporal UI       http://localhost:${puerto('TEMPORAL_UI_PORT', '8080')}
  Centrifugo        http://localhost:${puerto('CENTRIFUGO_PORT', '8000')}
  MinIO consola     http://localhost:${puerto('MINIO_CONSOLE_PORT', '9001')}
  Langfuse          http://localhost:${puerto('LANGFUSE_PORT', '3001')}  (usuario ${puerto('LANGFUSE_INIT_USER_EMAIL', 'dev@aiworkforce.local')}; contraseña en .env)
Para parar: pnpm dev:down
`);
