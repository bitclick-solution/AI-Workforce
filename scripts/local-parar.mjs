#!/usr/bin/env node
// `pnpm local:parar`: para api, web y el worker de la demo, y para el Compose.
// Conserva los volúmenes salvo que se pase `--volumenes` (los borra `local:a-cero`
// y la CI, que arranca desde cero en cada ejecución).
import { spawnSync } from 'node:child_process';

import { composeArgs, pararProcesosRegistrados, raiz, tieneBandera } from './local-comun.mjs';

const argumentos = process.argv.slice(2);

console.log('— Parando api, web y el worker de la demo');
const { todosParados } = pararProcesosRegistrados();

console.log('— Parando el Compose de desarrollo');
const extra = tieneBandera(argumentos, 'volumenes') ? ['--volumes'] : [];
const resultado = spawnSync('docker', [...composeArgs, 'down', ...extra], {
  cwd: raiz,
  stdio: 'inherit',
});
process.exit(todosParados ? (resultado.status ?? 1) : 1);
