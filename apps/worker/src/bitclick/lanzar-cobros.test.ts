import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EstadoLocal from './estado-local.js';

vi.mock('./estado-local.js', async (importarOriginal) => ({
  ...(await importarOriginal<typeof EstadoLocal>()),
  // Determinista sin importar si ya se ejecutó `bitclick:sembrar` en esta máquina.
  leerEstadoBitclick: () => undefined,
}));

const { principal } = await import('./lanzar-cobros.js');

/** Valor de prueba, largo y reconocible. No es una credencial real de nada. */
const CLAVE_DE_PRUEBA = 'clave-de-prueba-0d1a9f7c3b5e';

const ENTORNO_ODOO_COMPLETO = {
  ODOO_URL: 'https://odoo.ejemplo.local',
  ODOO_BASE: 'pruebas',
  ODOO_USUARIO: 'agente-mcp@ejemplo.local',
  ODOO_CLAVE_API: CLAVE_DE_PRUEBA,
};

describe('principal (validación de entorno, sin tocar Temporal ni la base)', () => {
  let salida: string[];
  let exitCodeOriginal: number | string | null | undefined;

  beforeEach(() => {
    salida = [];
    vi.spyOn(console, 'error').mockImplementation((...partes: unknown[]) => {
      salida.push(partes.map(String).join(' '));
    });
    exitCodeOriginal = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = exitCodeOriginal;
  });

  it('falla rápido si falta DATABASE_URL', async () => {
    await principal({});
    expect(salida.join('\n')).toContain('DATABASE_URL');
    expect(process.exitCode).toBe(1);
  });

  it('nombra las variables de Odoo que faltan, y no sus valores', async () => {
    await principal({ DATABASE_URL: 'postgres://x', ODOO_URL: 'https://odoo.local' });
    const mensaje = salida.join('\n');
    expect(mensaje).toContain('ODOO_BASE');
    expect(mensaje).toContain('ODOO_USUARIO');
    expect(mensaje).toContain('ODOO_CLAVE_API');
    expect(process.exitCode).toBe(1);
  });

  it('exige AIW_CONECTOR_ODOO=1 aunque las cuatro variables de Odoo estén', async () => {
    await principal({ DATABASE_URL: 'postgres://x', ...ENTORNO_ODOO_COMPLETO });
    const mensaje = salida.join('\n');
    expect(mensaje).toContain('AIW_CONECTOR_ODOO');
    expect(mensaje).not.toContain(CLAVE_DE_PRUEBA);
    expect(process.exitCode).toBe(1);
  });

  it('sin haber sembrado antes (sin .aiw-local/bitclick.json), dice que siembres primero', async () => {
    await principal({
      DATABASE_URL: 'postgres://x',
      AIW_CONECTOR_ODOO: '1',
      ...ENTORNO_ODOO_COMPLETO,
    });
    const mensaje = salida.join('\n');
    expect(mensaje).toContain('bitclick:sembrar');
    expect(mensaje).not.toContain(CLAVE_DE_PRUEBA);
    expect(process.exitCode).toBe(1);
  });
});
