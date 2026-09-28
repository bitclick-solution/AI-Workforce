#!/usr/bin/env node
// `pnpm local:copia`: copia de seguridad de PostgreSQL en un fichero, con
// `pg_dump` dentro del propio contenedor (formato a medida: comprimido y apto
// para `pg_restore`). Uso: `pnpm local:copia -- [nombre]`.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  asegurarCarpetaLocal,
  composeArgs,
  leerEnv,
  raiz,
  rutaCopias,
  rutaEnv,
} from './local-comun.mjs';

asegurarCarpetaLocal();
const env = leerEnv(rutaEnv);
const usuario = env.POSTGRES_USER || 'postgres';
const nombre = process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-');
const rutaSalida = join(rutaCopias, `${nombre}.dump`);

console.log(`— Volcando aiworkforce a ${rutaSalida}`);
const resultado = spawnSync(
  'docker',
  [...composeArgs, 'exec', '-T', 'postgres', 'pg_dump', '-U', usuario, '-Fc', '-d', 'aiworkforce'],
  { cwd: raiz, maxBuffer: 1024 ** 3 },
);
if (resultado.status !== 0 || resultado.error) {
  console.error(resultado.stderr?.toString() || resultado.error?.message || 'pg_dump ha fallado.');
  process.exit(resultado.status ?? 1);
}
writeFileSync(rutaSalida, resultado.stdout);
console.log(
  `Copia guardada: ${rutaSalida} (${(resultado.stdout.length / 1024 / 1024).toFixed(1)} MB).`,
);
console.log('Restaurar con: pnpm local:restaurar -- ' + rutaSalida);
