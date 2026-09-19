#!/usr/bin/env node
// Arranca el entorno de desarrollo con un solo comando.
// 1. Si no existe .env, lo crea desde .env.example con secretos aleatorios locales.
// 2. Si .env tiene nombres antiguos (MINIO_*), añade sus equivalentes S3_*.
// 3. Ejecuta `docker compose up -d --wait` sobre deploy/compose/docker-compose.dev.yml.
// Uso: `pnpm dev:up` · `pnpm dev:up --solo-env` (solo prepara .env) · argumentos extra van a docker compose.
import { spawnSync } from 'node:child_process';

import { asegurarEnv, composeArgs, leerEnv, migrarEnv, raiz } from './env-local.mjs';

const argumentos = process.argv.slice(2);
const soloEnv = argumentos.includes('--solo-env');
const extra = argumentos.filter((a) => a !== '--solo-env');

if (asegurarEnv()) {
  console.log('Creado .env con secretos aleatorios de desarrollo. No lo versiones.');
} else {
  console.log('Reutilizando .env existente.');
}
const migradas = migrarEnv();
if (migradas.length > 0) {
  console.log(
    `Añadidas a .env las variables ${migradas.join(', ')} a partir de los nombres MINIO_* anteriores.`,
  );
}

if (soloEnv) process.exit(0);

const resultado = spawnSync('docker', [...composeArgs, 'up', '-d', '--wait', ...extra], {
  cwd: raiz,
  stdio: 'inherit',
});

if (resultado.error) {
  console.error(`No se pudo ejecutar docker: ${resultado.error.message}`);
  process.exit(1);
}
if (resultado.status !== 0) process.exit(resultado.status ?? 1);

const env = leerEnv();
const puerto = (clave, porDefecto) => env[clave] || porDefecto;

console.log(`
Entorno de desarrollo arrancado:
  PostgreSQL        localhost:${puerto('POSTGRES_PORT', '5432')}  (bases aiworkforce, langfuse, temporal)
  Temporal          localhost:${puerto('TEMPORAL_PORT', '7233')}
  Temporal UI       http://localhost:${puerto('TEMPORAL_UI_PORT', '8080')}
  Centrifugo        http://localhost:${puerto('CENTRIFUGO_PORT', '8000')}
  Silo (S3) consola http://localhost:${puerto('S3_CONSOLE_PORT', puerto('MINIO_CONSOLE_PORT', '9001'))}
  Langfuse          http://localhost:${puerto('LANGFUSE_PORT', '3001')}  (usuario ${puerto('LANGFUSE_INIT_USER_EMAIL', 'dev@aiworkforce.local')}; contraseña en .env)
Para parar: pnpm dev:down
`);
