import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const parametros = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/puestos/[id]/expediente', () => {
  it('con la bandera apagada, 404 sin tocar la API', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    const respuesta = await GET(
      new Request('http://x/api/puestos/p1/expediente'),
      parametros('p1'),
    );
    expect(respuesta.status).toBe(404);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('reenvía la cookie de sesión a la API y devuelve su respuesta', async () => {
    vi.stubEnv('AIW_INICIO_PANEL', '1');
    vi.stubEnv('AIW_API_URL', 'http://api.local/');
    const buscar = vi.fn(
      async () => new Response(JSON.stringify({ expediente: { puestoId: 'p1' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', buscar);
    const respuesta = await GET(
      new Request('http://x/api/puestos/p1/expediente', {
        headers: { cookie: 'aiw.session_token=valida' },
      }),
      parametros('p1'),
    );
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ expediente: { puestoId: 'p1' } });
    const [url, opciones] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.local/puestos/p1/expediente');
    expect(opciones.method).toBe('GET');
    expect((opciones.headers as Record<string, string>)['cookie']).toContain('aiw.session_token');
  });

  it('no deja que el id cambie la ruta de la API', async () => {
    vi.stubEnv('AIW_INICIO_PANEL', '1');
    vi.stubEnv('AIW_API_URL', 'http://api.local');
    const buscar = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', buscar);
    await GET(new Request('http://x/api/puestos/x/expediente'), parametros('../avisos'));
    const [url] = buscar.mock.calls[0] as unknown as [string];
    expect(url).toBe('http://api.local/puestos/..%2Favisos/expediente');
  });
});
