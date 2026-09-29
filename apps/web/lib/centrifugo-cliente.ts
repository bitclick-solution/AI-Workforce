/**
 * Cliente mínimo del protocolo bidireccional de Centrifugo, solo para leer: conecta,
 * se suscribe a un canal privado con su propio token de canal y entrega cada
 * publicación. Nunca escribe nada por su cuenta —ni mensajes ni «escribiendo»—: eso
 * va siempre por la API (`crearFuenteDeSala` en `sala.ts`), que es la que tiene el
 * token y habla con `apps/api`.
 *
 * No se usa la librería oficial a propósito: lo que hace falta aquí es leer
 * publicaciones de un canal, y con eso el envoltorio a mano se prueba entero con un
 * WebSocket falso, sin abrir builds ni servidores en las pruebas.
 */

export interface WebSocketComoCliente {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((evento: { data: string }) => void) | null;
  send(datos: string): void;
  close(): void;
}

export type FabricaWebSocket = (url: string) => WebSocketComoCliente;

export interface OpcionesConexionCentrifugo {
  /** URL del WebSocket de Centrifugo, p. ej. ws://localhost:8000/connection/websocket. */
  url: string;
  token: string;
  canal: string;
  canalToken: string;
  alPublicar: (datos: unknown) => void;
  /**
   * Alguien se conectó o se desconectó del canal (presencia nativa de Centrifugo,
   * `join`/`leave`): quien llama decide qué hacer con esa persona, normalmente
   * volver a pedir sus miembros para tener el estado ya calculado.
   */
  alCambioDePresencia?: ((personaId: string) => void) | undefined;
  /** Conexión perdida o rechazada: quien llama decide el respaldo (consulta periódica). */
  alCaer: () => void;
  fabricaWebSocket?: FabricaWebSocket | undefined;
}

export interface ConexionCentrifugo {
  cerrar: () => void;
}

const ID_CONEXION = 1;
const ID_SUSCRIPCION = 2;

function fabricaPorDefecto(url: string): WebSocketComoCliente {
  return new WebSocket(url) as unknown as WebSocketComoCliente;
}

/** Conecta y se suscribe. Cualquier fallo de red o de Centrifugo cae en `alCaer`. */
export function conectarACentrifugo(opciones: OpcionesConexionCentrifugo): ConexionCentrifugo {
  const fabrica = opciones.fabricaWebSocket ?? fabricaPorDefecto;
  let cerradaAPeticion = false;
  const ws = fabrica(opciones.url);

  const caer = () => {
    if (!cerradaAPeticion) opciones.alCaer();
  };

  ws.onopen = () => {
    ws.send(JSON.stringify({ id: ID_CONEXION, connect: { token: opciones.token } }));
  };
  ws.onerror = caer;
  ws.onclose = caer;
  ws.onmessage = (evento) => {
    let mensaje: unknown;
    try {
      mensaje = JSON.parse(evento.data);
    } catch {
      return;
    }
    if (typeof mensaje !== 'object' || mensaje === null) return;
    const cuerpo = mensaje as {
      id?: number;
      error?: unknown;
      push?: {
        channel?: string;
        pub?: { data?: unknown };
        join?: { info?: { user?: string } };
        leave?: { info?: { user?: string } };
      };
    };
    if (cuerpo.error !== undefined) {
      caer();
      return;
    }
    if (cuerpo.id === ID_CONEXION) {
      ws.send(
        JSON.stringify({
          id: ID_SUSCRIPCION,
          subscribe: { channel: opciones.canal, token: opciones.canalToken },
        }),
      );
      return;
    }
    if (cuerpo.push?.channel !== opciones.canal) return;
    if (cuerpo.push.pub) {
      opciones.alPublicar(cuerpo.push.pub.data);
      return;
    }
    const personaId = cuerpo.push.join?.info?.user ?? cuerpo.push.leave?.info?.user;
    if (personaId) opciones.alCambioDePresencia?.(personaId);
  };

  return {
    cerrar: () => {
      cerradaAPeticion = true;
      ws.close();
    },
  };
}
