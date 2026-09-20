/**
 * Sin credenciales en el código de la aplicación de canales.
 *
 * Misma regla que en `@aiw/db` y `@aiw/ledger`, con la misma función: esta
 * aplicación maneja la clave de firma de los enlaces y las credenciales de SMTP,
 * así que es donde más caro sale escribir una a mano. La clave de las pruebas sale
 * de `randomBytes`, y las variables de entorno llegan del entorno.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/channels', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código de la aplicación', () => {
    expect(hallazgos.ficheros.length).toBeGreaterThan(10);
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
