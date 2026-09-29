/**
 * Sin credenciales en código, prompts ni registros. Misma regla que en `@aiw/db`:
 * este paquete firma tokens de Centrifugo con un secreto HMAC que solo puede venir
 * del entorno de quien lo llama, nunca de una cadena escrita aquí.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/rooms', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(hallazgos.ficheros.length).toBeGreaterThan(3);
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
