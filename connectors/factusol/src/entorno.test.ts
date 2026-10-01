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

describe('token de confirmación (ADR-031)', () => {
  const agente = jwt({ scope: 'lectura borrador' });
  const confirmar = jwt({ scope: 'confirmar' });

  it('es opcional: sin él la configuración no lo trae', () => {
    expect(
      leerConfiguracion({ ...BASE, FACTUSOL_MCP_TOKEN: agente }).tokenConfirmar,
    ).toBeUndefined();
  });

  it('se lee de una variable distinta de la del agente', () => {
    const configuracion = leerConfiguracion({
      ...BASE,
      FACTUSOL_MCP_TOKEN: agente,
      FACTUSOL_MCP_TOKEN_CONFIRMAR: confirmar,
    });
    expect(configuracion.token).toBe(agente);
    expect(configuracion.tokenConfirmar).toBe(confirmar);
  });

  it.each([
    ['es el mismo que el del agente', agente, agente, /no puede ser el token del agente/],
    ['no lleva el scope confirmar', agente, jwt({ scope: 'lectura' }), /no lleva el scope/],
    ['es demasiado corto', agente, 'x1y2z3', /demasiado corto/],
    [
      'no es un JWT',
      agente,
      'no-es-un-jwt-pero-es-largo',
      /FACTUSOL_MCP_TOKEN_CONFIRMAR no es un JWT/,
    ],
  ])('se rechaza si %s, sin nombrar ningún valor', (_caso, token, confirmacion, patron) => {
    try {
      leerConfiguracion({
        ...BASE,
        FACTUSOL_MCP_TOKEN: token,
        FACTUSOL_MCP_TOKEN_CONFIRMAR: confirmacion,
      });
      expect.unreachable('debía rechazarse');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toMatch(patron);
      expect(mensaje).not.toContain(confirmacion);
    }
  });

  it('el del agente sigue sin poder llevar el scope confirmar aunque exista el de confirmación', () => {
    expect(() =>
      leerConfiguracion({
        ...BASE,
        FACTUSOL_MCP_TOKEN: jwt({ scope: 'confirmar' }),
        FACTUSOL_MCP_TOKEN_CONFIRMAR: jwt({ scope: 'confirmar', otro: 1 }),
      }),
    ).toThrowError(/ese token no va nunca con las herramientas del agente/);
  });
});

describe('scopesDelToken', () => {
  it('un token sin scopes devuelve lista vacía', () => {
    expect(scopesDelToken(jwt({ sub: 'x' }))).toEqual([]);
  });
});
