/**
 * @aiw/evals
 *
 * Casos dorados por puesto, evaluadores y evals de humo para la integración continua.
 * Los evals de humo son deterministas y no llaman a ningún modelo.
 *
 * Esta rebanada solo fija la frontera del paquete y el contrato mínimo de un caso dorado.
 */
export const PAQUETE = {
  nombre: '@aiw/evals',
  tipo: 'paquete',
  responsabilidad:
    'Casos dorados por puesto, evaluadores y evals de humo para la integración continua.',
} as const;

export type Paquete = typeof PAQUETE;

export interface CasoDorado {
  /** Identificador estable, por ejemplo `cobros-014`. */
  readonly id: string;
  /** Puesto al que pertenece el caso. */
  readonly puesto: string;
  /** Entrada que recibe el agente. */
  readonly entrada: string;
  /** Salida esperada, comparada de forma exacta por el evaluador básico. */
  readonly esperado: string;
}

export interface ResultadoEval {
  readonly id: string;
  readonly superado: boolean;
  /** Entre 0 y 1. El evaluador básico solo produce 0 o 1. */
  readonly puntuacion: number;
  readonly diagnostico: string;
}

/** Casos dorados por puesto. Uno por comportamiento de agente. */
export * as cobros from './puestos/cobros.js';
export * as conciliacion from './puestos/conciliacion.js';

export function casoDorado(caso: CasoDorado): CasoDorado {
  if (caso.id.trim() === '') {
    throw new Error('Un caso dorado necesita un identificador.');
  }
  return caso;
}

/** Evaluador básico por igualdad exacta. Los evaluadores por modelo llegan con los evals por puesto. */
export function evaluarCasoDorado(caso: CasoDorado, obtenido: string): ResultadoEval {
  const superado = obtenido === caso.esperado;
  return {
    id: caso.id,
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? `${caso.id}: superado`
      : `${caso.id}: se esperaba "${caso.esperado}" y se obtuvo "${obtenido}"`,
  };
}
