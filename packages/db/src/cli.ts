/**
 * Órdenes de base de datos: `db:migrar` y `db:revertir`.
 *
 * La cadena de conexión llega por `DATABASE_URL` y nunca se escribe en el repositorio.
 */
import postgres from 'postgres';

import { aplicarMigraciones, comprobarHuellas, revertirMigraciones } from './migrador.js';

const orden = process.argv[2];
const url = process.env['DATABASE_URL'];

if (!url) {
  console.error('Falta DATABASE_URL. Arranca el Compose de desarrollo con `pnpm dev:up`.');
  process.exit(1);
}

const cliente = postgres(url, { max: 1, onnotice: () => undefined });

try {
  if (orden === 'migrar') {
    const problemas = await comprobarHuellas(cliente);
    if (problemas.length > 0) {
      console.error(problemas.join('\n'));
      process.exit(1);
    }
    const resultado = await aplicarMigraciones(cliente);
    console.warn(
      resultado.aplicadas.length > 0
        ? `Aplicadas: ${resultado.aplicadas.join(', ')}`
        : 'Nada que aplicar: la base ya está al día.',
    );
  } else if (orden === 'revertir') {
    const revertidas = await revertirMigraciones(cliente);
    console.warn(
      revertidas.length > 0 ? `Revertidas: ${revertidas.join(', ')}` : 'Nada que revertir.',
    );
  } else {
    console.error('Uso: db:migrar | db:revertir');
    process.exit(1);
  }
} finally {
  await cliente.end({ timeout: 5 });
}
