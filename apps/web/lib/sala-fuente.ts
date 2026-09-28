/**
 * La fuente de datos que usa la vista de Sala v1. Hoy es la simulada.
 *
 * El segundo PR en fusionarse (el del Diseñador o el del Constructor) la conecta
 * a `crearFuenteDeSala()` de `./sala` cambiando solo `crearFuente`. La
 * conversación y quién mira siguen simulados hasta que el contrato los cubra.
 */
import type { FuenteDeSala } from './sala-contrato';
import { crearFuenteSimulada } from './sala-simulada';

export function crearFuente(): FuenteDeSala {
  return crearFuenteSimulada();
}

export {
  ID_DE_QUIEN_MIRA,
  SALA_INICIAL_SIMULADA as SALA_INICIAL,
  conversacionSimulada as conversacionDeSala,
} from './sala-simulada';
export type { AutorDeEjemplo, MensajeDeEjemplo } from './sala-simulada';
