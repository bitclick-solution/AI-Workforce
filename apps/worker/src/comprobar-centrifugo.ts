/**
 * Comprobación barata de la CI (criterio 6 de «demo local en Windows»): abre una
 * conexión de verdad al Centrifugo del Compose, se suscribe a un canal `sala:`
 * real y comprueba con la API HTTP que la propia conexión sale en la presencia.
 *
 * No depende de PostgreSQL ni de Temporal: firma sus propios tokens con las
 * mismas funciones que usa la API de verdad (`tokenDeConexion`, `tokenDeCanal`)
 * y comprueba el espacio de nombres `sala` de
 * `deploy/compose/centrifugo/config.json` contra el Centrifugo real del
 * Compose — justo lo que las pruebas unitarias, que simulan Centrifugo, no
 * pueden ver (fallo 5: la CI no lo vio porque las pruebas actuales simulan
 * Centrifugo).
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
const secretoHmac = process.env['CENTRIFUGO_TOKEN_HMAC_SECRET_KEY'];
const claveApi = process.env['CENTRIFUGO_API_KEY'];
if (!secretoHmac || !claveApi) {
  fallar('faltan CENTRIFUGO_TOKEN_HMAC_SECRET_KEY o CENTRIFUGO_API_KEY en el entorno.');
}

const tenantId = randomUUID();
const salaId = randomUUID();
const personaId = randomUUID();
const canal = canalDeSala(tenantId, salaId);

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
});

interface MensajeCentrifugo {
  id?: number;
  connect?: unknown;
  subscribe?: unknown;
  error?: { code: number; message: string };
}

/** Se conecta y se suscribe a `canal`; resuelve cuando Centrifugo acepta la suscripción. */
function suscribir(): Promise<void> {
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
      const mensaje = JSON.parse(String(evento.data)) as MensajeCentrifugo;
      if (mensaje.error) {
        clearTimeout(limite);
        socket.close();
        rechazar(new Error(`Centrifugo rechazó la petición: ${mensaje.error.code} ${mensaje.error.message}`));
        return;
      }
      if (mensaje.connect) {
        enviar({ subscribe: { channel: canal, token: tokenCanal } });
        return;
      }
      if (mensaje.subscribe) {
        clearTimeout(limite);
        socket.close();
        resolver();
      }
    });
    socket.addEventListener('error', () => {
      clearTimeout(limite);
      rechazar(new Error('la conexión de WebSocket con Centrifugo falló.'));
    });
  });
}

decir(`canal ${canal}`);
try {
  await suscribir();
} catch (error) {
  fallar(error instanceof Error ? error.message : 'la suscripción falló.');
}
decir('suscripción aceptada por Centrifugo.');

const presencia = await presenciaDeSala(
  { urlApi, claveApi, secretoHmac },
  tenantId,
  salaId,
  fetch as unknown as Parameters<typeof presenciaDeSala>[3],
);
if (!presencia.some((p) => p.personaId === personaId)) {
  fallar('la presencia del canal no incluye a la conexión de prueba.');
}
decir(`presencia: ${presencia.length} conexión(es), la de prueba incluida.`);
process.exit(0);
