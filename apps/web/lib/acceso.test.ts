import { describe, expect, it, vi } from 'vitest';

import {
  accesoActivo,
  cookiesDelAcceso,
  reenviarAcceso,
  sesionDelPanel,
  urlDeLaApi,
  type Buscador,
} from './acceso';

describe('bandera y configuración del acceso', () => {
  it('solo 1 o true encienden el acceso', () => {
    expect(accesoActivo({})).toBe(false);
    expect(accesoActivo({ AIW_ACCESO_PANEL: '0' })).toBe(false);
    expect(accesoActivo({ AIW_ACCESO_PANEL: '1' })).toBe(true);
    expect(accesoActivo({ AIW_ACCESO_PANEL: 'true' })).toBe(true);
  });

  it('la URL de la API pierde la barra final', () => {
    expect(urlDeLaApi({ AIW_API_URL: 'http://api:3002/' })).toBe('http://api:3002');
    expect(urlDeLaApi({ AIW_API_URL: '  ' })).toBeUndefined();
  });
});

describe('cookies que salen hacia la API', () => {
  it('solo las del acceso, con o sin __Secure-', () => {
    expect(
      cookiesDelAcceso(
        'otra=1; aiw.session_token=abc.def; _ga=xyz; __Secure-aiw.session_token=ghi; aiw.passkey=r',
      ),
    ).toBe('aiw.session_token=abc.def; __Secure-aiw.session_token=ghi; aiw.passkey=r');
    expect(cookiesDelAcceso('analitica=1')).toBe('');
    expect(cookiesDelAcceso(null)).toBe('');
  });
});

describe('reenvío de /api/auth', () => {
  it('pasa método, cuerpo, origen y cookie del acceso, y no sigue redirecciones', async () => {
    let vista: { url: string; opciones: RequestInit } | undefined;
    const buscar: Buscador = async (url, opciones) => {
      vista = { url, opciones };
      const cabeceras = new Headers({ location: 'http://localhost:3000/panel/cuenta' });
      cabeceras.append('set-cookie', 'aiw.session_token=nueva; Path=/; HttpOnly');
      cabeceras.append('set-cookie', 'aiw.otra=2; Path=/');
      cabeceras.set('x-interna', 'no-debe-salir');
      return new Response(null, { status: 302, headers: cabeceras });
    };
    const respuesta = await reenviarAcceso(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link?x=1', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          cookie: 'aiw.session_token=vieja; analitica=1',
          'x-aiw-tenant': 'lo-que-sea',
        },
        body: '{"email":"a@b.es"}',
      }),
      'http://api:3002',
      buscar,
    );
    expect(vista?.url).toBe('http://api:3002/api/auth/sign-in/magic-link?x=1');
    expect(vista?.opciones.redirect).toBe('manual');
    const ida = new Headers(vista?.opciones.headers);
    expect(ida.get('cookie')).toBe('aiw.session_token=vieja');
    expect(ida.get('origin')).toBe('http://localhost:3000');
    expect(ida.get('x-aiw-tenant')).toBeNull();
    expect(new TextDecoder().decode(vista?.opciones.body as ArrayBuffer)).toBe(
      '{"email":"a@b.es"}',
    );

    expect(respuesta.status).toBe(302);
    expect(respuesta.headers.get('location')).toBe('http://localhost:3000/panel/cuenta');
    expect(respuesta.headers.getSetCookie()).toHaveLength(2);
    expect(respuesta.headers.get('x-interna')).toBeNull();
    expect(respuesta.headers.get('cache-control')).toBe('no-store');
  });

  it('un GET no lleva cuerpo', async () => {
    const buscar = vi.fn<Buscador>(async () => Response.json({ ok: true }));
    await reenviarAcceso(
      new Request('http://localhost:3000/api/auth/get-session'),
      'http://api:3002',
      buscar,
    );
    expect(buscar.mock.calls[0]?.[1].body).toBeUndefined();
  });

  it('si la API no responde, 502 sin la dirección interna', async () => {
    const respuesta = await reenviarAcceso(
      new Request('http://localhost:3000/api/auth/get-session'),
      'http://api-interna:3002',
      () => Promise.reject(new Error('connect ECONNREFUSED api-interna:3002')),
    );
    expect(respuesta.status).toBe(502);
    expect(await respuesta.text()).not.toContain('api-interna');
  });
});

describe('sesión del panel', () => {
  it('sin cookie del acceso no pregunta', async () => {
    const buscar = vi.fn<Buscador>();
    expect(await sesionDelPanel('http://api:3002', 'otra=1', buscar)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it('devuelve nombre, correo y caducidad de una sesión válida', async () => {
    const buscar: Buscador = async () =>
      Response.json({
        user: { name: 'Ana', email: 'ana@alfa.example' },
        session: { expiresAt: '2026-09-29T00:00:00.000Z' },
      });
    expect(await sesionDelPanel('http://api:3002', 'aiw.session_token=x', buscar)).toEqual({
      nombre: 'Ana',
      correo: 'ana@alfa.example',
      caducaEn: '2026-09-29T00:00:00.000Z',
    });
  });

  it('una sesión nula, un error o una API caída son «sin sesión»', async () => {
    for (const buscar of [
      (async () => Response.json(null)) as Buscador,
      (async () => new Response('', { status: 500 })) as Buscador,
      (() => Promise.reject(new Error('caída'))) as Buscador,
    ]) {
      expect(await sesionDelPanel('http://api:3002', 'aiw.session_token=x', buscar)).toBeNull();
    }
  });
});
