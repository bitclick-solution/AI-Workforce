import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  ErrorCentrifugo,
  firmaValida,
  presenciaDeSala,
  publicarEnSala,
  tokenDeCanal,
  tokenDeConexion,
  type BuscadorCentrifugo,
  type ConfiguracionCentrifugo,
} from './centrifugo';

const SECRETO = randomUUID();
const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const SALA = '01a0d39e-98c3-7970-814a-0a98ad132313';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';

function partesDe(token: string): { cabecera: unknown; carga: Record<string, unknown> } {
  const [cabecera, carga] = token.split('.');
  const decodificar = (trozo: string) =>
    JSON.parse(Buffer.from(trozo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { cabecera: decodificar(cabecera ?? ''), carga: decodificar(carga ?? '') };
}

describe('tokens de Centrifugo', () => {
  it('el de conexión lleva la persona como sub y el tenant en info', () => {
    const token = tokenDeConexion(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      ttlSegundos: 300,
    });
    const { cabecera, carga } = partesDe(token);
    expect(cabecera).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(carga['sub']).toBe(PERSONA);
    expect((carga['info'] as { tenantId: string }).tenantId).toBe(TENANT);
    expect(firmaValida(SECRETO, token)).toBe(true);
    expect(firmaValida('otro-secreto', token)).toBe(false);
  });

  it('el de canal restringe el canal a esta sala de este tenant', () => {
    const token = tokenDeCanal(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      salaId: SALA,
      ttlSegundos: 300,
    });
    const { carga } = partesDe(token);
    expect(carga['channel']).toBe(`sala:${TENANT}:${SALA}`);
    // Ni con el mismo secreto sirve un token de otra sala para esta: el canal
    // firmado es el de la sala pedida en el momento de mintarlo, no el que se
    // quiera usar después.
    const deOtraSala = tokenDeCanal(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      salaId: randomUUID(),
      ttlSegundos: 300,
    });
    expect(partesDe(deOtraSala)['carga']['channel']).not.toBe(carga['channel']);
  });

  it('sin ocultarPresencia, el de canal no lleva override: Centrifugo cuenta la conexión', () => {
    const token = tokenDeCanal(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      salaId: SALA,
      ttlSegundos: 300,
    });
    expect(partesDe(token)['carga']['override']).toBeUndefined();
  });

  it('con ocultarPresencia, el de canal apaga presence y join_leave (ADR-026)', () => {
    const token = tokenDeCanal(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      salaId: SALA,
      ttlSegundos: 300,
      ocultarPresencia: true,
    });
    const { carga } = partesDe(token);
    expect(carga['override']).toEqual({
      presence: { value: false },
      join_leave: { value: false },
    });
  });

  it('caduca a los segundos pedidos, no antes ni mucho después', () => {
    const ahora = 1_700_000_000_000;
    const token = tokenDeConexion(SECRETO, {
      personaId: PERSONA,
      tenantId: TENANT,
      ttlSegundos: 60,
      ahoraMs: ahora,
    });
    const { carga } = partesDe(token);
    expect(carga['exp']).toBe(Math.floor(ahora / 1000) + 60);
  });

  it('firmaValida rechaza un token con menos o más de tres partes', () => {
    expect(firmaValida(SECRETO, 'sin.puntos')).toBe(false);
    expect(firmaValida(SECRETO, 'a.b.c.d')).toBe(false);
  });
});

function configuracion(): ConfiguracionCentrifugo {
  return { urlApi: 'http://centrifugo.local:8000', claveApi: 'clave-de-api', secretoHmac: SECRETO };
}

describe('llamadas al API HTTP de Centrifugo', () => {
  it('publica en el canal de la sala con la clave de API en la cabecera', async () => {
    const buscar: BuscadorCentrifugo = vi.fn(async () => new Response('{}', { status: 200 }));
    await publicarEnSala(configuracion(), TENANT, SALA, { tipo: 'escribiendo' }, buscar);
    expect(buscar).toHaveBeenCalledWith(
      'http://centrifugo.local:8000/api',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'clave-de-api' }),
      }),
    );
    const llamada = vi.mocked(buscar).mock.calls[0];
    const cuerpo = JSON.parse((llamada?.[1] as { body: string }).body);
    expect(cuerpo).toEqual({
      method: 'publish',
      params: { channel: `sala:${TENANT}:${SALA}`, data: { tipo: 'escribiendo' } },
    });
  });

  it('presenciaDeSala devuelve las personas únicas conectadas al canal', async () => {
    const buscar: BuscadorCentrifugo = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              presence: {
                cliente1: { user: PERSONA },
                cliente2: { user: PERSONA },
                cliente3: { user: 'otra-persona' },
              },
            },
          }),
          { status: 200 },
        ),
    );
    const presencia = await presenciaDeSala(configuracion(), TENANT, SALA, buscar);
    expect(presencia.map((p) => p.personaId).sort()).toEqual(['otra-persona', PERSONA].sort());
  });

  it('sin presencia (sala vacía o Centrifugo sin datos) devuelve una lista vacía', async () => {
    const buscar: BuscadorCentrifugo = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await presenciaDeSala(configuracion(), TENANT, SALA, buscar)).toEqual([]);
  });

  it('un canal rechazado lanza ErrorCentrifugo en vez de degradarse en silencio (fallo 5)', async () => {
    const buscar: BuscadorCentrifugo = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 102, message: 'unknown channel' } }), {
          status: 200,
        }),
    );
    await expect(presenciaDeSala(configuracion(), TENANT, SALA, buscar)).rejects.toThrow(
      ErrorCentrifugo,
    );
    await expect(presenciaDeSala(configuracion(), TENANT, SALA, buscar)).rejects.toThrow(
      /102.*unknown channel/,
    );
  });
});
