import { describe, expect, it, vi } from 'vitest';

import { perfilDelPanel, reenviarPerfil, type Buscador } from './perfil';

describe('perfil del panel', () => {
  it('sin cookie del acceso no pregunta', async () => {
    const buscar = vi.fn<Buscador>();
    expect(await perfilDelPanel('http://api:3002', 'otra=1', buscar)).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
  });

  it('devuelve el ajuste de una respuesta válida', async () => {
    const buscar: Buscador = async () => Response.json({ mostrarPresencia: false });
    expect(
      await perfilDelPanel('http://api:3002', 'aiw.session_token=x', buscar),
    ).toEqual({ mostrarPresencia: false });
  });

  it('sin sesión, un error o una API caída son «sin ajuste»', async () => {
    for (const buscar of [
      (async () => Response.json({})) as Buscador,
      (async () => new Response('', { status: 401 })) as Buscador,
      (() => Promise.reject(new Error('caída'))) as Buscador,
    ]) {
      expect(await perfilDelPanel('http://api:3002', 'aiw.session_token=x', buscar)).toBeNull();
    }
  });
});

describe('reenvío de /api/perfil', () => {
  it('un GET solo lleva la cookie del acceso', async () => {
    let vista: { url: string; opciones: RequestInit } | undefined;
    const buscar: Buscador = async (url, opciones) => {
      vista = { url, opciones };
      return Response.json({ mostrarPresencia: true });
    };
    await reenviarPerfil(
      new Request('http://localhost:3000/api/perfil', {
        headers: { cookie: 'aiw.session_token=x; analitica=1' },
      }),
      'http://api:3002',
      buscar,
    );
    expect(vista?.url).toBe('http://api:3002/perfil');
    const cabeceras = new Headers(vista?.opciones.headers);
    expect(cabeceras.get('cookie')).toBe('aiw.session_token=x');
    expect(vista?.opciones.body).toBeUndefined();
  });

  it('un PATCH reenvía el cuerpo tal cual', async () => {
    let vista: { url: string; opciones: RequestInit } | undefined;
    const buscar: Buscador = async (url, opciones) => {
      vista = { url, opciones };
      return Response.json({ mostrarPresencia: false });
    };
    const respuesta = await reenviarPerfil(
      new Request('http://localhost:3000/api/perfil', {
        method: 'PATCH',
        headers: { cookie: 'aiw.session_token=x', 'x-aiw-persona': 'no-debe-salir' },
        body: JSON.stringify({ mostrarPresencia: false }),
      }),
      'http://api:3002',
      buscar,
    );
    expect(vista?.opciones.body).toBe('{"mostrarPresencia":false}');
    const cabeceras = new Headers(vista?.opciones.headers);
    expect(cabeceras.get('x-aiw-persona')).toBeNull();
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ mostrarPresencia: false });
  });

  it('si la API no responde, 502 sin la dirección interna', async () => {
    const respuesta = await reenviarPerfil(
      new Request('http://localhost:3000/api/perfil'),
      'http://api-interna:3002',
      () => Promise.reject(new Error('connect ECONNREFUSED api-interna:3002')),
    );
    expect(respuesta.status).toBe(502);
    expect(await respuesta.text()).not.toContain('api-interna');
  });
});
