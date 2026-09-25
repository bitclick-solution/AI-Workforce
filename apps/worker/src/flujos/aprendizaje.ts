/**
 * Flujo durable del aprendizaje v0: `aprendizajeDeSenal`.
 *
 * Una edición del borrador antes de aprobar arranca este flujo, con identificador
 * `aprendizaje-<aprobacionId>`: una edición, un flujo. Registra la señal y propone
 * la lección, y termina. La lección espera a una persona: en v0 no hay promoción
 * automática (docs/specs/aprendizaje-v0.md, decisión 6).
 *
 * Es un flujo aparte y no un paso de la tarea porque el aprendizaje no debe
 * retrasar ni hacer fallar el trabajo: la tarea lo lanza y sigue, y si el
 * aprendizaje falla, la tarea ya terminó bien.
 */
import { proxyActivities } from '@temporalio/workflow';

import type { Actividades } from '../actividades/index.js';

const internas = proxyActivities<
  Pick<Actividades, 'registrarSenalDeEdicion' | 'proponerLeccionDeSenal'>
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
    maximumAttempts: 120,
  },
});

/** Prefijo del identificador del flujo: uno por aprobación editada. */
export const PREFIJO_FLUJO_APRENDIZAJE = 'aprendizaje-';

export interface EntradaAprendizajeDeSenal {
  tenantId: string;
  aprobacionId: string;
}

export interface ResultadoAprendizajeDeSenal {
  senalId: string;
  leccionId: string;
  puestoId: string;
  linea: string;
}

export async function aprendizajeDeSenal(
  entrada: EntradaAprendizajeDeSenal,
): Promise<ResultadoAprendizajeDeSenal> {
  const senal = await internas.registrarSenalDeEdicion(entrada);
  const leccion = await internas.proponerLeccionDeSenal({
    tenantId: entrada.tenantId,
    senalId: senal.senalId,
    senalCreadoEn: senal.senalCreadoEn,
  });
  return {
    senalId: senal.senalId,
    leccionId: leccion.leccionId,
    puestoId: leccion.puestoId,
    linea: leccion.linea,
  };
}
