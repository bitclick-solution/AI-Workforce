/** Configuración y token: el conector no arranca con un token que confirma. */
import { describe, expect, it } from 'vitest';

import { hayCredenciales, leerConfiguracion, scopesDelToken } from './entorno.js';

function jwt(carga: Record<string, unknown>): string {
  const parte = (objeto: unknown): string =>
    Buffer.from(JSON.stringify(objeto)).toString('base64url');
  return `${parte({ alg: 'HS256', typ: 'JWT' })}.${parte(carga)}.firma-inventada-0001`;
}

const BASE = {
  FACTUSOL_MCP_URL: 'https://factusol.local/sse',
  FACTUSOL_TENANT_ID: 'tenant-de-prueba',
};

describe('leerConfiguracion', () => {
  it('lee la configuración con un token de solo lectura', () => {
    const token = jwt({ sub: 'agente', scope: 'lectura borrador' });
    expect(leerConfiguracion({ ...BASE, FACTUSOL_MCP_TOKEN: token })).toEqual({
      extremoMcp: BASE.FACTUSOL_MCP_URL,
      token,
      tenantId: BASE.FACTUSOL_TENANT_ID,
    });
  });

  it.each([
    ['scope en cadena', { scope: 'lectura confirmar' }],
    ['scope separado por comas', { scope: 'lectura,confirmar' }],
    ['scopes en lista', { scopes: ['lectura', 'confirmar'] }],
    ['scp en lista', { scp: ['confirmar'] }],
  ])('se niega a arrancar con el scope confirmar (%s)', (_caso, carga) => {
    const token = jwt(carga);
    try {
      leerConfiguracion({ ...BASE, FACTUSOL_MCP_TOKEN: token });
      expect.unreachable('debía negarse');
    } catch (error) {
      expect(error).toMatchObject({ motivo: 'no_autorizado' });
      expect((error as Error).message).toContain('confirmar');
      expect((error as Error).message).not.toContain(token);
    }
  });

  it('nombra lo que falta y nunca un valor', () => {
    expect(() =>
      leerConfiguracion({ FACTUSOL_MCP_URL: 'https://factusol.local/sse' }),
    ).toThrowError(/FACTUSOL_MCP_TOKEN, FACTUSOL_TENANT_ID/);
  });

  it('rechaza una URL con credenciales dentro', () => {
    expect(() =>
      leerConfiguracion({
        ...BASE,
        FACTUSOL_MCP_URL: 'https://usuario:clave@factusol.local/sse',
        FACTUSOL_MCP_TOKEN: jwt({}),
      }),
    ).toThrowError(/no puede llevar usuario ni contraseña/);
  });

  it.each([['corto'], ['no.es.jwt.de.tres.partes'], ['aaaaaaaa.bbbbbbbb.cccccccc']])(
    'rechaza un token que no es un JWT legible (%s)',
    (token) => {
      expect(() => leerConfiguracion({ ...BASE, FACTUSOL_MCP_TOKEN: token })).toThrowError(
        expect.objectContaining({ motivo: 'invalido' }),
      );
    },
  );

  it('hayCredenciales pide las tres variables', () => {
    expect(hayCredenciales({ ...BASE })).toBe(false);
    expect(hayCredenciales({ ...BASE, FACTUSOL_MCP_TOKEN: jwt({}) })).toBe(true);
  });
});

describe('scopesDelToken', () => {
  it('un token sin scopes devuelve lista vacía', () => {
    expect(scopesDelToken(jwt({ sub: 'x' }))).toEqual([]);
  });
});
