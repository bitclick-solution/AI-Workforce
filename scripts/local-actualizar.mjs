#!/usr/bin/env node
// `pnpm local:actualizar`: trae `main`, instala dependencias si han cambiado y migra
// la base. No reinicia api, web ni el worker: hazlo con `pnpm local:parar && pnpm
// local:arrancar` para que corran con el código nuevo.
import { spawnSync } from 'node:child_process';

import { leerEnv, raiz, rutaEnv, urlBaseDeDatos } from './local-comun.mjs';

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
if (ejecutar('pnpm', ['install']).status !== 0) salir('`pnpm install` ha fallado.');

console.log('— Migrando la base');
try {
  const env = leerEnv(rutaEnv);
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
