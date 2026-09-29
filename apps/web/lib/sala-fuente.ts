/**
 * La fuente de datos que usa la vista de Sala v1.
 *
 * Segundo PR en fusionarse (el del Constructor, tras el del Diseñador): conecta
 * `crearFuente` a `crearFuenteDeSala()` de `./sala` —la API por HTTP y
 * Centrifugo por WebSocket, con caída a consulta periódica—, tal como decía este
 * comentario antes de conectarla. La conversación y quién mira siguen simulados
 * en `./sala-simulada` mientras el contrato no cubra la conversación y algo más
 * que salas, miembros y presencia.
 *
 * `?fuenteSimulada=1` en la URL fuerza la simulada aunque la real esté
 * conectada: lo usa `e2e/sala-v1.spec.ts` (ver `playwright.config.ts`), que
 * prueba la interfaz sola, sin levantar la API, PostgreSQL ni Centrifugo. Es
 * una comodidad de este fichero, no del contrato: `VistaDeSalaV1` sigue sin
 * saber de dónde vienen sus datos.
 */
import type { FuenteDeSala } from './sala-contrato';
import { crearFuenteDeSala } from './sala';
import { crearFuenteSimulada } from './sala-simulada';

function fuenteSimuladaPedidaPorUrl(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fuenteSimulada') === '1';
}

export function crearFuente(): FuenteDeSala {
  return fuenteSimuladaPedidaPorUrl() ? crearFuenteSimulada() : crearFuenteDeSala();
}

export {
  ID_DE_QUIEN_MIRA,
  SALA_INICIAL_SIMULADA as SALA_INICIAL,
  conversacionSimulada as conversacionDeSala,
} from './sala-simulada';
export type { AutorDeEjemplo, MensajeDeEjemplo } from './sala-simulada';
