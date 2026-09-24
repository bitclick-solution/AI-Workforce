/**
 * Sin credenciales escritas en el código, y aquí con más razón que en ningún sitio.
 *
 * Este paquete es el único que resuelve secretos de conector. Si alguna vez se le
 * cuela una credencial literal —aunque sea de juguete, aunque sea en una prueba—,
 * la frontera de «las credenciales nunca entran en el contexto del modelo» deja de
 * significar nada. Misma regla que en `@aiw/db` y `@aiw/ledger`, con la misma
 * función, para que no haya tres criterios distintos.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/mcp-gateway', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(hallazgos.ficheros.length).toBeGreaterThan(5);
  });

  it('ninguna cadena de conexión lleva contraseña', () => {
    expect(
      hallazgos.conexionesConContrasena,
      `Credenciales en: ${hallazgos.conexionesConContrasena.join(', ')}`,
    ).toEqual([]);
  });

  it('ninguna contraseña ni clave está escrita en el código', () => {
    expect(
      hallazgos.clavesLiterales,
      `Claves literales en: ${hallazgos.clavesLiterales.join(', ')}`,
    ).toEqual([]);
  });
});
