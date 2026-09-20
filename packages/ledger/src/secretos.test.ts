/**
 * Sin credenciales en código, prompts ni registros, también en el libro de auditoría.
 *
 * Misma regla que en `@aiw/db`, que es donde vive: este paquete maneja la conexión
 * y escribe la entrada de auditoría, así que es justo donde no puede colarse una
 * credencial ni acabar en un registro.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/ledger', () => {
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
