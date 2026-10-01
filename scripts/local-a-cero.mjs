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
// `await`: desde el segundo seguimiento de «demo local en Windows»,
// `pararProcesosRegistrados` es async (da un margen de hasta 2 s por servicio
// a que el puerto se libere antes de identificar y rematar un huérfano). Sin
// esperarla, `docker compose down --volumes` y el borrado de `.aiw-local/` de
// abajo (justo el `procesos.json` que esa lógica necesita) se adelantaban a
// que terminara — hallazgo del Revisor, visto antes de que esto llegara a
// ejecutarse de verdad.
const { todosParados } = await pararProcesosRegistrados();
if (!todosParados) {
  console.warn(
    '  algún proceso no se pudo parar del todo; se continúa igualmente: a-cero lo borra todo.',
  );
}

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
