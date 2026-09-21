/**
 * Sin credenciales en el código de la API.
 *
 * Misma regla que en `@aiw/db` y `@aiw/ledger`, con la misma función: el token de
 * lectura del contador y la cadena de conexión llegan del entorno, y esta prueba
 * falla en local si alguien los escribe aquí, antes de que lo haga `gitleaks` en la
 * integración continua.
 */
import { fileURLToPath } from 'node:url';

import { buscarSecretos } from '@aiw/db/pruebas';
import { describe, expect, it } from 'vitest';

import { VARIABLE_AUTORIZACION } from './rutas/contador';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

describe('sin secretos en @aiw/api', () => {
  const hallazgos = buscarSecretos(RAIZ);

  it('encuentra el código de la aplicación', () => {
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

  it('el token del contador se lee del entorno y no está escrito', () => {
    expect(VARIABLE_AUTORIZACION).toBe('AIW_CONTADOR_TOKEN');
  });
});
