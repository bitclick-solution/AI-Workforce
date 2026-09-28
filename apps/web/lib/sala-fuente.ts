/**
 * La fuente de datos que usa la vista de Sala v1.
 *
 * Segundo PR en fusionarse (el del Constructor, tras el del Diseñador): conecta
 * `crearFuente` a `crearFuenteDeSala()` de `./sala` —la API por HTTP y
 * Centrifugo por WebSocket, con caída a consulta periódica—, tal como decía este
 * comentario antes de conectarla. La conversación y quién mira siguen simulados
 * en `./sala-simulada` mientras el contrato no cubra la conversación y algo más
 * que salas, miembros y presencia.
 */
import type { FuenteDeSala } from './sala-contrato';
import { crearFuenteDeSala } from './sala';

export function crearFuente(): FuenteDeSala {
  return crearFuenteDeSala();
}

export {
  ID_DE_QUIEN_MIRA,
  SALA_INICIAL_SIMULADA as SALA_INICIAL,
  conversacionSimulada as conversacionDeSala,
} from './sala-simulada';
export type { AutorDeEjemplo, MensajeDeEjemplo } from './sala-simulada';
