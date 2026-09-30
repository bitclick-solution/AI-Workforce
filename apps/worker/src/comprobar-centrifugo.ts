/**
 * Comprobación barata de la CI (criterio 6 de «demo local en Windows»): abre dos
 * conexiones de verdad al Centrifugo del Compose, las suscribe a un canal
 * `sala:` real y comprueba con la API HTTP quién sale en la presencia.
 *
 * No depende de PostgreSQL ni de Temporal: firma sus propios tokens con las
 * mismas funciones que usa la API de verdad (`tokenDeConexion`, `tokenDeCanal`)
 * y comprueba el espacio de nombres `sala` de
 * `deploy/compose/centrifugo/config.json` contra el Centrifugo real del
 * Compose — justo lo que las pruebas unitarias, que simulan Centrifugo, no
 * pueden ver (fallo 5: la CI no lo vio porque las pruebas actuales simulan
 * Centrifugo).
 *
 * También comprueba, contra ese mismo Centrifugo real, la presencia oculta del
 * PR #49 (ADR-026): una conexión cuyo token de canal lleva el `override` de
 * `ocultarPresencia` no debe salir en la presencia del canal, aunque esté
 * conectada. El propio #49 solo lo probó con Centrifugo simulado (pedido de la
 * sesión de dirección tras el cambio de orden de fusión con este PR).
 *
 *   pnpm --filter @aiw/worker comprobar:centrifugo
 */
import { randomUUID } from 'node:crypto';

import { canalDeSala, SEGUNDOS_TOKEN_CENTRIFUGO } from '@aiw/rooms';
import { presenciaDeSala, tokenDeCanal, tokenDeConexion } from '@aiw/rooms/centrifugo';

const PLAZO_MS = 10_000;

function decir(texto: string): void {
  process.stdout.write(`[comprobar-centrifugo] ${texto}\n`);
}

function fallar(mensaje: string): never {
  console.error(`[comprobar-centrifugo] ${mensaje}`);
  process.exit(1);
}

const urlApi = process.env['AIW_CENTRIFUGO_URL'] ?? 'http://127.0.0.1:8000';
const urlWs = process.env['AIW_CENTRIFUGO_WS_URL'] ?? 'ws://127.0.0.1:8000/connection/websocket';
const secretoHmacEntorno = process.env['CENTRIFUGO_TOKEN_HMAC_SECRET_KEY'];
const claveApiEntorno = process.env['CENTRIFUGO_API_KEY'];
if (!secretoHmacEntorno || !claveApiEntorno) {
  fallar('faltan CENTRIFUGO_TOKEN_HMAC_SECRET_KEY o CENTRIFUGO_API_KEY en el entorno.');
}
// Constantes aparte (no los `let` del entorno): dentro de conectarYSuscribir, una
// función declarada, TS no arrastra el estrechamiento de tipo de este `if` sobre
// una variable capturada por clausura.
const secretoHmac: string = secretoHmacEntorno;
const claveApi: string = claveApiEntorno;

const tenantId = randomUUID();
const salaId = randomUUID();
const canal = canalDeSala(tenantId, salaId);

interface MensajeCentrifugo {
  id?: number;
  connect?: unknown;
  subscribe?: unknown;
  error?: { code: number; message: string };
}

/**
 * Conecta y se suscribe a `canal`; resuelve con el socket ya suscrito (sin
 * cerrarlo: hace falta seguir conectado mientras se consulta la presencia por
 * HTTP) cuando Centrifugo acepta la suscripción.
 */
function conectarYSuscribir(personaId: string, ocultarPresencia: boolean): Promise<WebSocket> {
  const tokenConexion = tokenDeConexion(secretoHmac, {
    personaId,
    tenantId,
    ttlSegundos: SEGUNDOS_TOKEN_CENTRIFUGO,
  });
  const tokenCanal = tokenDeCanal(secretoHmac, {
    personaId,
    tenantId,
    salaId,
    ttlSegundos: SEGUNDOS_TOKEN_CENTRIFUGO,
    ocultarPresencia,
  });
  return new Promise((resolver, rechazar) => {
    const limite = setTimeout(() => {
      socket.close();
      rechazar(new Error(`Centrifugo no confirmó la suscripción en ${PLAZO_MS / 1000} s.`));
    }, PLAZO_MS);
    const socket = new WebSocket(urlWs);
    let siguienteId = 0;
    const enviar = (carga: Record<string, unknown>) => {
      siguienteId += 1;
      socket.send(JSON.stringify({ id: siguienteId, ...carga }));
    };
    socket.addEventListener('open', () => enviar({ connect: { token: tokenConexion } }));
    socket.addEventListener('message', (evento) => {
      // El protocolo JSON de Centrifugo puede repartir varias respuestas en un
      // solo frame de WebSocket, una por línea (lo vio esta misma comprobación
      // contra el Centrifugo real de la CI: `JSON.parse` sin más fallaba con
      // «Unexpected non-whitespace character» en cuanto `connect` y `subscribe`
      // llegaban juntos). Cada línea no vacía es un mensaje aparte.
      for (const linea of String(evento.data).split('\n')) {
        if (linea.trim().length === 0) continue;
        const mensaje = JSON.parse(linea) as MensajeCentrifugo;
        if (mensaje.error) {
          clearTimeout(limite);
          socket.close();
          rechazar(
            new Error(
              `Centrifugo rechazó la petición: ${mensaje.error.code} ${mensaje.error.message}`,
            ),
          );
          return;
        }
        if (mensaje.connect) {
          enviar({ subscribe: { channel: canal, token: tokenCanal } });
          continue;
        }
        if (mensaje.subscribe) {
          clearTimeout(limite);
          resolver(socket);
          return;
        }
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(limite);
      rechazar(new Error('la conexión de WebSocket con Centrifugo falló.'));
    });
  });
}

const personaVisible = randomUUID();
const personaOculta = randomUUID();

decir(`canal ${canal}`);
let socketVisible: WebSocket;
let socketOculta: WebSocket;
try {
  socketVisible = await conectarYSuscribir(personaVisible, false);
  socketOculta = await conectarYSuscribir(personaOculta, true);
} catch (error) {
  fallar(error instanceof Error ? error.message : 'la suscripción falló.');
}
decir('las dos conexiones de prueba están suscritas.');

try {
  const presencia = await presenciaDeSala(
    { urlApi, claveApi, secretoHmac },
    tenantId,
    salaId,
    fetch as unknown as Parameters<typeof presenciaDeSala>[3],
  );
  const personas = presencia.map((p) => p.personaId);
  if (!personas.includes(personaVisible)) {
    fallar('la presencia del canal no incluye a la conexión visible de prueba.');
  }
  if (personas.includes(personaOculta)) {
    fallar(
      'la presencia oculta (ADR-026, override del token de canal) no se respetó: ' +
        'la conexión oculta de prueba sale en la presencia del canal.',
    );
  }
  decir(`presencia: ${presencia.length} conexión(es); la visible sale, la oculta no.`);
} finally {
  socketVisible.close();
  socketOculta.close();
}
process.exit(0);
