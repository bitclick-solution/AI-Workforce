/**
 * Sin credenciales en código, prompts ni registros, comprobado por prueba.
 *
 * La regla vive en `./pruebas/secretos.ts` y la comparten `@aiw/db` y `@aiw/ledger`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLAVE_LITERAL, CONEXION_CON_CONTRASENA, buscarSecretos } from './pruebas/secretos.js';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/db', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código del paquete', () => {
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

  it('la conexión llega del entorno, no del código', () => {
    const cli = readFileSync(join(RAIZ, 'src/cli.ts'), 'utf8');
    expect(cli).toContain("process.env['DATABASE_URL']");
  });

  it('la regla detecta de verdad lo que dice detectar', () => {
    // Sin esto, una expresión regular rota daría «limpio» para siempre. Las cadenas
    // se parten para que ni este fichero ni `gitleaks` las lean como un secreto.
    expect(CONEXION_CON_CONTRASENA.test('postgresql://aiw:' + 'unaClaveLarga' + '@host/db')).toBe(
      true,
    );
    expect(CONEXION_CON_CONTRASENA.test('postgresql://aiw@host/db')).toBe(false);
    expect(CLAVE_LITERAL.test('pass' + "word: 'unaClaveLarga'")).toBe(true);
    expect(CLAVE_LITERAL.test('pass' + "word: 'GENERAR'")).toBe(false);
  });
});
