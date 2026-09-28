import { describe, expect, it, vi } from 'vitest';

import { conectarACentrifugo, type WebSocketComoCliente } from './centrifugo-cliente';

function socketFalso(): WebSocketComoCliente & { enviados: unknown[] } {
  const enviados: unknown[] = [];
  return {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    enviados,
    send(datos: string) {
      enviados.push(JSON.parse(datos));
    },
    close() {
      this.onclose?.();
    },
  };
}

const OPCIONES_BASE = {
  url: 'ws://centrifugo.local/connection/websocket',
  token: 'token-de-conexion',
  canal: 'sala:tenant:sala1',
  canalToken: 'token-de-canal',
};

describe('conectarACentrifugo', () => {
  it('al abrir, manda el connect; al confirmarlo, se suscribe al canal con su token', () => {
    const socket = socketFalso();
    conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: () => undefined,
      alCaer: () => undefined,
      fabricaWebSocket: () => socket,
    });

    socket.onopen?.();
    expect(socket.enviados).toEqual([{ id: 1, connect: { token: 'token-de-conexion' } }]);

    socket.onmessage?.({ data: JSON.stringify({ id: 1, connect: {} }) });
    expect(socket.enviados[1]).toEqual({
      id: 2,
      subscribe: { channel: 'sala:tenant:sala1', token: 'token-de-canal' },
    });
  });

  it('entrega los datos de cada publicación del canal suscrito', () => {
    const socket = socketFalso();
    const recibidos: unknown[] = [];
    conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: (datos) => recibidos.push(datos),
      alCaer: () => undefined,
      fabricaWebSocket: () => socket,
    });
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ id: 1, connect: {} }) });

    socket.onmessage?.({
      data: JSON.stringify({
        push: { channel: 'sala:tenant:sala1', pub: { data: { tipo: 'mensaje' } } },
      }),
    });
    expect(recibidos).toEqual([{ tipo: 'mensaje' }]);
  });

  it('ignora publicaciones de otro canal', () => {
    const socket = socketFalso();
    const recibidos: unknown[] = [];
    conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: (datos) => recibidos.push(datos),
      alCaer: () => undefined,
      fabricaWebSocket: () => socket,
    });
    socket.onmessage?.({
      data: JSON.stringify({ push: { channel: 'sala:tenant:otra', pub: { data: {} } } }),
    });
    expect(recibidos).toEqual([]);
  });

  it('un join o un leave del canal avisan con la persona, no con un mensaje', () => {
    const socket = socketFalso();
    const personas: string[] = [];
    const publicados: unknown[] = [];
    conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: (datos) => publicados.push(datos),
      alCambioDePresencia: (personaId) => personas.push(personaId),
      alCaer: () => undefined,
      fabricaWebSocket: () => socket,
    });

    socket.onmessage?.({
      data: JSON.stringify({
        push: { channel: 'sala:tenant:sala1', join: { info: { user: 'persona-1' } } },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        push: { channel: 'sala:tenant:sala1', leave: { info: { user: 'persona-2' } } },
      }),
    });
    expect(personas).toEqual(['persona-1', 'persona-2']);
    expect(publicados).toEqual([]);
  });

  it('un error de Centrifugo, un cierre o un mensaje que no es JSON caen en alCaer', () => {
    const alCaer = vi.fn();
    const socket = socketFalso();
    conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: () => undefined,
      alCaer,
      fabricaWebSocket: () => socket,
    });

    socket.onerror?.();
    expect(alCaer).toHaveBeenCalledTimes(1);
    socket.onclose?.();
    expect(alCaer).toHaveBeenCalledTimes(2);
    socket.onmessage?.({ data: JSON.stringify({ id: 1, error: { code: 109 } }) });
    expect(alCaer).toHaveBeenCalledTimes(3);
  });

  it('cerrar() no cuenta como una caída', () => {
    const alCaer = vi.fn();
    const socket = socketFalso();
    const conexion = conectarACentrifugo({
      ...OPCIONES_BASE,
      alPublicar: () => undefined,
      alCaer,
      fabricaWebSocket: () => socket,
    });
    conexion.cerrar();
    expect(alCaer).not.toHaveBeenCalled();
  });
});
