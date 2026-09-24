/**
 * Sin credenciales en código, prompts ni registros, también en lo que se aprende.
 *
 * Misma regla que en `@aiw/db`: lo que escribe este paquete acaba en la memoria del
 * puesto y de ahí en el prompt de cada tarea, así que es justo donde no puede
 * colarse una credencial. Los datos personales los cubre `pruebas/aprendizaje.test.ts`.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/learning', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(hallazgos.ficheros.length).toBeGreaterThan(4);
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
