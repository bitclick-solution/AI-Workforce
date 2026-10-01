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

/** Casos dorados de los agentes de plataforma que viven en paquetes. */
export * as moderador from './plataforma/moderador.js';
export * as aprendizaje from './plataforma/aprendizaje.js';
export * as habilidades from './plataforma/habilidades.js';

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

/**
 * Caso dorado de salida estructurada: la entrada y la salida esperada son un
 * objeto, no una cadena. Los puestos de negocio (Cobros, Conciliación) deciden con
 * una salida estructurada estricta (ADR-018), no con texto libre que haya que
 * interpretar.
 */
export interface CasoDoradoEstructurado<T> {
  readonly id: string;
  readonly puesto: string;
  readonly entrada: unknown;
  readonly esperado: T;
}

export function casoDoradoEstructurado<T>(
  caso: CasoDoradoEstructurado<T>,
): CasoDoradoEstructurado<T> {
  if (caso.id.trim() === '') {
    throw new Error('Un caso dorado necesita un identificador.');
  }
  return caso;
}

/** Compara por igualdad estructural (JSON), no por referencia: es lo que importa de una salida validada por esquema. */
export function evaluarCasoDoradoEstructurado<T>(
  caso: CasoDoradoEstructurado<T>,
  obtenido: T,
): ResultadoEval {
  const superado = JSON.stringify(obtenido) === JSON.stringify(caso.esperado);
  return {
    id: caso.id,
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? `${caso.id}: superado`
      : `${caso.id}: se esperaba ${JSON.stringify(caso.esperado)} y se obtuvo ${JSON.stringify(obtenido)}`,
  };
}
