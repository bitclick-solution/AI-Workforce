/**
 * Actividades del aprendizaje v0: de la edición a la señal y de la señal a la lección.
 *
 * La lógica vive en `@aiw/learning`; aquí solo se adapta a Temporal. Cada operación
 * es idempotente —por aprobación la señal, por señal la lección—, así que un
 * reintento tras una caída encuentra lo que ya hizo en vez de duplicarlo. Los
 * errores de datos (la aprobación no es una edición, la edición no cambia nada) se
 * marcan como no reintentables: insistir no los arregla.
 *
 * La promoción y la reversión no son actividades: las hace una persona desde el CLI
 * o, más adelante, desde el panel. En v0 ningún flujo promociona solo.
 */
import {
  ErrorDeAprendizaje,
  proponerLeccion,
  registrarSenalDeEdicion,
  type LeccionPropuesta,
  type SenalRegistrada,
} from '@aiw/learning';
import { ApplicationFailure } from '@temporalio/activity';

import type { ContextoDeActividades } from './contexto.js';

async function sinReintentoSiEsDeDatos<T>(cuerpo: () => Promise<T>): Promise<T> {
  try {
    return await cuerpo();
  } catch (error) {
    if (error instanceof ErrorDeAprendizaje) {
      throw ApplicationFailure.create({
        message: error.message,
        type: `ErrorDeAprendizaje.${error.codigo}`,
        nonRetryable: true,
      });
    }
    throw error;
  }
}

export function crearActividadesDeAprendizaje(contexto: ContextoDeActividades) {
  return {
    /** Convierte la edición de una aprobación en una señal `correccion`. */
    async registrarSenalDeEdicion(peticion: {
      tenantId: string;
      aprobacionId: string;
    }): Promise<SenalRegistrada> {
      return sinReintentoSiEsDeDatos(() =>
        registrarSenalDeEdicion(contexto.cliente, peticion.tenantId, peticion.aprobacionId),
      );
    },

    /** Propone la lección de memoria de una señal. Queda en `propuesta`. */
    async proponerLeccionDeSenal(peticion: {
      tenantId: string;
      senalId: string;
      senalCreadoEn: string;
    }): Promise<LeccionPropuesta> {
      return sinReintentoSiEsDeDatos(() =>
        proponerLeccion(contexto.cliente, peticion.tenantId, peticion),
      );
    },
  };
}
