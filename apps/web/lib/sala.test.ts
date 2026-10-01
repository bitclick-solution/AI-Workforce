import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configuracionSala,
  crearFuenteDeSala,
  esNotaDelModerador,
  etiquetaDeAutor,
  llamarSala,
  propuestaDelMensaje,
  salaActiva,
  urlWebSocketCentrifugo,
  type MensajeDeLaSala,
} from './sala';
import type { CambioDeSala } from './sala-contrato';

const COOKIE = 'aiw.session_token=de-la-prueba';
const ENTORNO = {
  AIW_SALA_V0: '1',
  AIW_API_URL: 'http://api.local/',
  AIW_SALA_TOKEN: crypto.randomUUID(),
};

function mensaje(parcial: Partial<MensajeDeLaSala>): MensajeDeLaSala {
  return {
    id: 'm',
    cuerpo: 'hola',
    autor: { tipo: 'persona', nombre: 'Jesús' },
    adjuntos: [],
    creadoEn: new Date(0).toISOString(),
    ...parcial,
  };
}

describe('sala en el panel', () => {
  it('sin bandera o sin configuración completa no hay sala', () => {
    expect(salaActiva({})).toBe(false);
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_V0: '0' })).toBeUndefined();
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_TOKEN: ' ' })).toBeUndefined();
    // El tenant y la persona de entorno ya no existen: aunque estén, no se usan.
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_TENANT: 'x' })).toEqual({
      apiUrl: 'http://api.local',
      token: ENTORNO.AIW_SALA_TOKEN,
    });
    expect(configuracionSala(ENTORNO)?.apiUrl).toBe('http://api.local');
  });

  it('pone el token y la cookie de sesión en el servidor, y ningún tenant ni persona', async () => {
    const configuracion = configuracionSala(ENTORNO);
    if (!configuracion) throw new Error('falta configuración');
    let vista: { url: string; headers: Record<string, string>; body?: string } | undefined;
    const respuesta = await llamarSala(
      configuracion,
      'POST',
      '/sala/mensajes',
      (url, opciones) => {
        vista = {
          url,
          headers: opciones.headers,
          ...(opciones.body ? { body: opciones.body } : {}),
        };
        return Promise.resolve(new Response(JSON.stringify({ mensajeId: 'x' }), { status: 202 }));
      },
      COOKIE,
      { texto: 'hola' },
    );
    expect(respuesta).toEqual({ estado: 202, cuerpo: { mensajeId: 'x' } });
    expect(vista?.url).toBe('http://api.local/sala/mensajes');
    expect(vista?.headers['cookie']).toBe(COOKIE);
    expect(vista?.headers['x-aiw-persona']).toBeUndefined();
    expect(vista?.headers['x-aiw-tenant']).toBeUndefined();
    expect(vista?.headers['authorization']).toBe(`Bearer ${ENTORNO.AIW_SALA_TOKEN}`);
    expect(vista?.body).toBe('{"texto":"hola"}');
  });

  it('una API caída no filtra su dirección', async () => {
    const configuracion = configuracionSala(ENTORNO);
    if (!configuracion) throw new Error('falta configuración');
    const respuesta = await llamarSala(
      configuracion,
      'GET',
      '/sala',
      () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.7:3002')),
      COOKIE,
    );
    expect(respuesta.estado).toBe(502);
    expect(JSON.stringify(respuesta.cuerpo)).not.toContain('10.0.0.7');
  });

  it('pliega al moderador, firma a cada autor y encuentra la tarjeta de la propuesta', () => {
    const nota = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Moderador' },
      adjuntos: [{ tipo: 'moderacion', decision: 'intervenir' }],
    });
    expect(esNotaDelModerador(nota)).toBe(true);
    expect(etiquetaDeAutor(nota)).toBe('Moderador · plataforma');
    expect(etiquetaDeAutor(mensaje({ autor: { tipo: 'puesto', nombre: 'Cobros' } }))).toBe(
      'Cobros · agente',
    );
    const tarjeta = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Director de IA' },
      adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: 'p1' }],
    });
    const propuesta = {
      id: 'p1',
      resumen: 'r',
      estado: 'pendiente',
      nivelExigido: 'n1',
      costeEstimadoEuros: 50,
      efectos: {},
    };
    expect(propuestaDelMensaje(tarjeta, [propuesta])).toBe(propuesta);
    // La presentación del agente contratado cita la propuesta, pero no lleva la tarjeta.
    expect(
      propuestaDelMensaje({ ...tarjeta, autor: { tipo: 'puesto', nombre: 'Conciliación' } }, [
        propuesta,
      ]),
    ).toBeUndefined();
  });
});

describe('detalles de chat', () => {
  it('iniciales, hora y «respondiendo»', async () => {
    const { iniciales, horaCorta, esperandoRespuesta } = await import('./sala');
    expect(iniciales('Conciliación bancaria')).toBe('C');
    expect(iniciales('Director de IA')).toBe('DI');
    expect(iniciales('Jesús')).toBe('J');
    expect(horaCorta('no es fecha')).toBe('');
    expect(horaCorta('2026-09-24T13:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    const persona = mensaje({});
    const nota = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Moderador' },
      adjuntos: [{ tipo: 'moderacion' }],
    });
    const agente = mensaje({ autor: { tipo: 'puesto', nombre: 'Cobros' } });
    expect(esperandoRespuesta([persona, nota])).toBe(true);
    expect(esperandoRespuesta([persona, nota, agente])).toBe(false);
    expect(esperandoRespuesta([])).toBe(false);
  });
});

describe('sala v1: URL pública de Centrifugo', () => {
  it('urlWebSocketCentrifugo lee del entorno', () => {
    expect(urlWebSocketCentrifugo({})).toBeUndefined();
    expect(urlWebSocketCentrifugo({ AIW_CENTRIFUGO_WS_URL: 'ws://x/y' })).toBe('ws://x/y');
  });
});

class WebSocketFalso {
  static instancias: WebSocketFalso[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evento: { data: string }) => void) | null = null;
  enviados: unknown[] = [];
  constructor(public readonly url: string) {
    WebSocketFalso.instancias.push(this);
  }
  send(datos: string): void {
    this.enviados.push(JSON.parse(datos));
  }
  close(): void {
    this.onclose?.();
  }
}

function ultimoWebSocket(): WebSocketFalso {
  const ws = WebSocketFalso.instancias.at(-1);
  if (!ws) throw new Error('No se abrió ningún WebSocket.');
  return ws;
}

function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

describe('crearFuenteDeSala: la fuente real de la sala v1', () => {
  const SALA_ID = '01a0d39e-98c3-7970-814a-0a98ad132313';

  beforeEach(() => {
    WebSocketFalso.instancias = [];
    vi.stubGlobal('WebSocket', WebSocketFalso);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('salas() y miembros() piden a la API por HTTP', async () => {
    const buscar = vi.fn(async (url: string) => {
      if (url === '/api/sala/salas') {
        return respuestaJson({
          salas: [{ id: SALA_ID, nombre: 'General', ambito: 'general', sinLeer: 0, menciones: 0 }],
        });
      }
      if (url === `/api/sala/${SALA_ID}/miembros`) {
        return respuestaJson({
          miembros: [{ id: 'p1', tipo: 'persona', nombre: 'Jesús', estado: 'en-la-sala' }],
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', buscar);

    const fuente = crearFuenteDeSala();
    const salas = await fuente.salas();
    expect(salas).toEqual([
      { id: SALA_ID, nombre: 'General', ambito: 'general', sinLeer: 0, menciones: 0 },
    ]);
    const miembros = await fuente.miembros(SALA_ID);
    expect(miembros).toEqual([
      { id: 'p1', tipo: 'persona', nombre: 'Jesús', estado: 'en-la-sala' },
    ]);
  });

  it('indicarEscritura avisa a la API sin esperar respuesta', () => {
    const buscar = vi.fn(async () => respuestaJson({ ok: true }));
    vi.stubGlobal('fetch', buscar);
    crearFuenteDeSala().indicarEscritura(SALA_ID);
    expect(buscar).toHaveBeenCalledWith(
      `/api/sala/${SALA_ID}/escribiendo`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('suscribir() con token y wsUrl se conecta a Centrifugo y reparte mensajes y escritura', async () => {
    const buscar = vi.fn(async (url: string) => {
      if (url === `/api/sala/${SALA_ID}/token`) {
        return respuestaJson({
          token: 'tok',
          canalToken: 'canal-tok',
          canal: `sala:t:${SALA_ID}`,
          wsUrl: 'ws://centrifugo.local/connection/websocket',
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', buscar);

    const cambios: CambioDeSala[] = [];
    const cancelar = crearFuenteDeSala().suscribir(SALA_ID, (c) => cambios.push(c));
    // La conexión se abre de forma asíncrona: se espera a que el WebSocket falso exista.
    await vi.waitFor(() => expect(WebSocketFalso.instancias).toHaveLength(1));
    const ws = ultimoWebSocket();
    ws.onopen?.();
    expect(ws.enviados).toEqual([{ id: 1, connect: { token: 'tok' } }]);

    ws.onmessage?.({ data: JSON.stringify({ id: 1, connect: {} }) });
    expect(ws.enviados[1]).toEqual({
      id: 2,
      subscribe: { channel: `sala:t:${SALA_ID}`, token: 'canal-tok' },
    });

    ws.onmessage?.({
      data: JSON.stringify({
        push: { channel: `sala:t:${SALA_ID}`, pub: { data: { tipo: 'mensaje' } } },
      }),
    });
    ws.onmessage?.({
      data: JSON.stringify({
        push: {
          channel: `sala:t:${SALA_ID}`,
          pub: { data: { tipo: 'escribiendo', personaId: 'p1', hasta: '2026-01-01T00:00:00Z' } },
        },
      }),
    });
    expect(cambios).toEqual([
      { tipo: 'mensaje', salaId: SALA_ID },
      { tipo: 'escribiendo', salaId: SALA_ID, miembroId: 'p1', hasta: '2026-01-01T00:00:00Z' },
    ]);

    cancelar();
    expect(ws.onclose).not.toBeNull(); // cerrar() llama a ws.close(), que dispara onclose.
  });

  it('un join de Centrifugo vuelve a pedir los miembros y reparte la presencia de esa persona', async () => {
    const buscar = vi.fn(async (url: string) => {
      if (url === `/api/sala/${SALA_ID}/token`) {
        return respuestaJson({
          token: 'tok',
          canalToken: 'canal-tok',
          canal: `sala:t:${SALA_ID}`,
          wsUrl: 'ws://centrifugo.local/connection/websocket',
        });
      }
      if (url === `/api/sala/${SALA_ID}/miembros`) {
        return respuestaJson({
          miembros: [{ id: 'p1', tipo: 'persona', nombre: 'Jesús', estado: 'en-la-sala' }],
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', buscar);

    const cambios: CambioDeSala[] = [];
    crearFuenteDeSala().suscribir(SALA_ID, (c) => cambios.push(c));
    await vi.waitFor(() => expect(WebSocketFalso.instancias).toHaveLength(1));
    const ws = ultimoWebSocket();
    ws.onmessage?.({
      data: JSON.stringify({
        push: { channel: `sala:t:${SALA_ID}`, join: { info: { user: 'p1' } } },
      }),
    });

    await vi.waitFor(() =>
      expect(cambios).toEqual([
        {
          tipo: 'presencia',
          salaId: SALA_ID,
          miembro: { id: 'p1', tipo: 'persona', nombre: 'Jesús', estado: 'en-la-sala' },
        },
      ]),
    );
  });

  it('sin token de Centrifugo, o si la llamada falla, cae en consulta periódica', async () => {
    vi.useFakeTimers();
    const buscar = vi.fn(async () => {
      throw new Error('La API no responde.');
    });
    vi.stubGlobal('fetch', buscar);

    const cambios: CambioDeSala[] = [];
    crearFuenteDeSala().suscribir(SALA_ID, (c) => cambios.push(c));
    await vi.advanceTimersByTimeAsync(0);
    expect(WebSocketFalso.instancias).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(cambios).toEqual([{ tipo: 'mensaje', salaId: SALA_ID }]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cambios).toHaveLength(2);
  });

  it('si Centrifugo cae tras conectar, se pasa a consulta periódica', async () => {
    vi.useFakeTimers();
    const buscar = vi.fn(async (url: string) => {
      if (url === `/api/sala/${SALA_ID}/token`) {
        return respuestaJson({
          token: 'tok',
          canalToken: 'canal-tok',
          canal: `sala:t:${SALA_ID}`,
          wsUrl: 'ws://centrifugo.local/connection/websocket',
        });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', buscar);

    const cambios: CambioDeSala[] = [];
    crearFuenteDeSala().suscribir(SALA_ID, (c) => cambios.push(c));
    await vi.advanceTimersByTimeAsync(0);
    const ws = ultimoWebSocket();
    ws.onerror?.();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(cambios).toEqual([{ tipo: 'mensaje', salaId: SALA_ID }]);
  });

  it('cancelar la suscripción cierra Centrifugo y para la consulta periódica', async () => {
    vi.useFakeTimers();
    const buscar = vi.fn(async () => {
      throw new Error('La API no responde.');
    });
    vi.stubGlobal('fetch', buscar);

    const cambios: CambioDeSala[] = [];
    const cancelar = crearFuenteDeSala().suscribir(SALA_ID, (c) => cambios.push(c));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cambios).toHaveLength(1);
    cancelar();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cambios).toHaveLength(1);
  });

  it('mensajes() pide la conversación y las propuestas de la sala por GET', async () => {
    const propuesta = {
      id: 'p1',
      resumen: 'r',
      estado: 'pendiente',
      nivelExigido: 'n1',
      costeEstimadoEuros: 0,
      efectos: {},
    };
    const buscar = vi.fn(async (url: string) => {
      if (url === `/api/sala?salaId=${SALA_ID}`) {
        return respuestaJson({ mensajes: [mensaje({ id: 'm1' })], propuestas: [propuesta] });
      }
      throw new Error(`URL inesperada: ${url}`);
    });
    vi.stubGlobal('fetch', buscar);

    const conversacion = await crearFuenteDeSala().mensajes(SALA_ID);
    expect(conversacion).toEqual({ mensajes: [mensaje({ id: 'm1' })], propuestas: [propuesta] });
  });

  it('enviarMensaje() publica el texto y la sala por POST a /api/sala/mensajes', async () => {
    const buscar = vi.fn(async (url: string, opciones: RequestInit) => {
      expect(url).toBe('/api/sala/mensajes');
      expect(opciones.method).toBe('POST');
      expect(JSON.parse(opciones.body as string)).toEqual({ texto: 'hola', salaId: SALA_ID });
      return respuestaJson({ mensajeId: 'x' }, 202);
    });
    vi.stubGlobal('fetch', buscar);

    await expect(crearFuenteDeSala().enviarMensaje(SALA_ID, 'hola')).resolves.toBeUndefined();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('enviarMensaje() lanza con el motivo de la API cuando la respuesta no es ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuestaJson({ error: 'Texto vacío.' }, 400)),
    );
    await expect(crearFuenteDeSala().enviarMensaje(SALA_ID, '')).rejects.toThrow('Texto vacío.');
  });

  it('enviarMensaje() lanza con el estado HTTP cuando la respuesta no trae {error} válido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no es json', { status: 500 })),
    );
    await expect(crearFuenteDeSala().enviarMensaje(SALA_ID, 'hola')).rejects.toThrow(
      'La API de la sala respondió 500.',
    );
  });

  it('decidirPropuesta() publica el sentido por POST a /api/sala/propuestas/:id/decision', async () => {
    const buscar = vi.fn(async (url: string, opciones: RequestInit) => {
      expect(url).toBe('/api/sala/propuestas/p1/decision');
      expect(opciones.method).toBe('POST');
      expect(JSON.parse(opciones.body as string)).toEqual({ sentido: 'aprobada' });
      return respuestaJson({ ok: true });
    });
    vi.stubGlobal('fetch', buscar);

    await expect(crearFuenteDeSala().decidirPropuesta('p1', 'aprobada')).resolves.toBeUndefined();
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('decidirPropuesta() también lanza con el motivo de la API cuando la respuesta no es ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuestaJson({ error: 'Ya decidida.' }, 409)),
    );
    await expect(crearFuenteDeSala().decidirPropuesta('p1', 'rechazada')).rejects.toThrow(
      'Ya decidida.',
    );
  });
});
