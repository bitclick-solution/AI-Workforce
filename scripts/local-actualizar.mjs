#!/usr/bin/env node
// `pnpm local:actualizar`: trae `main`, instala dependencias si han cambiado y migra
// la base. No reinicia api, web ni el worker: hazlo con `pnpm local:parar && pnpm
// local:arrancar` para que corran con el código nuevo.
import { spawnSync } from 'node:child_process';

import {
  leerEnv,
  puertoOcupado,
  raiz,
  rutaEnv,
  urlBaseDeDatos,
  valorEntorno,
} from './local-comun.mjs';

function ejecutar(mandato, argumentos, opciones = {}) {
  return spawnSync(mandato, argumentos, { cwd: raiz, stdio: 'inherit', ...opciones });
}

function salir(mensaje) {
  console.error(mensaje);
  process.exit(1);
}

const rama = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: raiz,
  encoding: 'utf8',
}).stdout.trim();
if (rama !== 'main') {
  salir(
    `Estás en la rama «${rama}», no en main. \`local:actualizar\` solo trae main sobre main: ` +
      'cambia de rama a mano si es otra cosa lo que quieres.',
  );
}

const sucio = spawnSync('git', ['status', '--porcelain'], {
  cwd: raiz,
  encoding: 'utf8',
}).stdout.trim();
if (sucio) {
  salir('Hay cambios sin confirmar en main. Guárdalos o descártalos antes de actualizar.');
}

console.log('— Trayendo main');
if (ejecutar('git', ['pull', 'origin', 'main', '--ff-only']).status !== 0) {
  salir('`git pull --ff-only` ha fallado (main ha divergido de origin/main). Resuélvelo a mano.');
}

console.log('— Instalando dependencias');
// `CI: 'true'`: sin él, `pnpm install` pregunta por una consola interactiva si
// hace falta purgar `node_modules` y, sin TTY (una terminal que no es
// interactiva, o algunos lanzadores de Windows), aborta con
// `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` en vez de seguir — visto de
// verdad en la máquina de Jesús tras el #50. `pnpm` ya se salta esa pregunta
// en CI; forzarlo aquí es lo mismo sin depender de que la terminal lo sea.
if (ejecutar('pnpm', ['install'], { env: { ...process.env, CI: 'true' } }).status !== 0) {
  salir('`pnpm install` ha fallado.');
}

console.log('— Migrando la base');
const env = leerEnv(rutaEnv);
// Comprobación explícita en vez de dejar que la migración falle con un
// `ECONNREFUSED` críptico: si acabas de `pnpm local:parar`, el Compose (y
// Postgres con él) ya no está arriba, y `db:migrar` no lo arranca por su
// cuenta — visto de verdad tras el #50, con el mensaje de error del cliente
// de postgres sin decir qué hacer.
const puertoPostgres = valorEntorno(env, 'POSTGRES_PORT', '5432');
if (!(await puertoOcupado(puertoPostgres))) {
  salir(
    `Postgres no responde en el puerto ${puertoPostgres}: el Compose no está arriba. ` +
      'Arráncalo con `pnpm local:arrancar` (o `pnpm dev:up` si solo quieres la infraestructura) y repite `pnpm local:actualizar`.',
  );
}
try {
  const migracion = ejecutar('pnpm', ['--filter', '@aiw/db', 'db:migrar'], {
    env: { ...process.env, DATABASE_URL: urlBaseDeDatos(env) },
  });
  if (migracion.status !== 0) salir('La migración ha fallado.');
} catch (error) {
  salir(`${error.message} ¿Está arrancado el entorno? Prueba primero \`pnpm local:arrancar\`.`);
}

console.log(
  '\nActualizado. Reinicia con `pnpm local:parar && pnpm local:arrancar` para usar el código nuevo.',
);
