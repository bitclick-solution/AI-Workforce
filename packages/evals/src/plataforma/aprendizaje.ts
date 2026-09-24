/**
 * Caso dorado del aprendizaje y puerta del Evaluador para las promociones.
 *
 * Qué se evalúa: una edición del borrador antes de aprobar produce una lección de
 * memoria acotada al ADR-005 —clase `memoria`, destino el puesto, nunca el modelo
 * base—, que recoge lo que la persona escribió y no arrastra ningún dato personal
 * del cliente. Es lo que la versión siguiente del puesto verá en su prompt.
 *
 * La puerta: el Evaluador certifica o bloquea cada promoción (`.claude/agents/evaluador.md`).
 * En v0 certifica solo si pasan los casos dorados de Cobros, Conciliación y este, y
 * si la memoria candidata entera respeta las mismas reglas. La evaluación en sombra
 * contra las últimas 50 tareas llega con la rebanada siguiente del bucle.
 *
 * No llama a ningún modelo: la lección se redacta con la plantilla determinista de
 * `@aiw/learning`, la misma que corre en producción en v0.
 */
import {
  CLASES_LECCION,
  contieneDatosPersonales,
  diferenciaDeBorradores,
  redactarLeccion,
  type PuertaDeEvaluacion,
  type ResultadoDeLaPuerta,
  type VersionCandidata,
} from '@aiw/learning';

import { type ResultadoEval } from '../index.js';
import { ejecutarCasoCobros } from '../puestos/cobros.js';
import { ejecutarCasoConciliacion } from '../puestos/conciliacion.js';

export const CASO_APRENDIZAJE = 'aprendizaje-001';

export const EVALUADOR = 'evaluador-v0';

/** Más líneas que esto en la memoria de un puesto es ruido en cada prompt. */
export const MAXIMO_LINEAS_MEMORIA = 50;

/** Largo máximo de una línea de memoria. */
export const MAXIMO_LARGO_LINEA = 700;

/** La edición del caso: la persona tutea y deja datos del cliente que no deben aprenderse. */
export const EDICION = {
  tipoBorrador: 'herramienta.redactar_nota',
  claseAccion: 'comunicar',
  antes: {
    conector: 'demo',
    argumentos: { factura: 'F-2026-0001', texto: 'Le recordamos que su factura está vencida.' },
  },
  despues: {
    conector: 'demo',
    argumentos: {
      factura: 'F-2026-0001',
      texto:
        'Te escribo para recordarte que tu factura está vencida. Si ya la pagaste, ' +
        'escríbeme a marta.garcia@cliente-demo.es o llama al 612 345 678.',
    },
  },
  /** Lo que la lección tiene que conservar de lo que escribió la persona. */
  debeConservar: 'Te escribo para recordarte',
} as const;

export interface LeccionEvaluable {
  linea: string;
  parametros: { clase: string; destino: string; valor: unknown };
}

/** Evalúa una lección por propiedades. Cada regla tiene su contraejemplo en el eval. */
export function evaluarLeccion(leccion: LeccionEvaluable, debeConservar: string): ResultadoEval {
  const fallos: string[] = [];
  if (leccion.parametros.clase !== 'memoria') {
    fallos.push(`la clase es «${leccion.parametros.clase}» y en v0 solo se aprende memoria`);
  }
  if (!(CLASES_LECCION as readonly string[]).includes(leccion.parametros.clase)) {
    fallos.push('la clase está fuera del ADR-005');
  }
  if (leccion.parametros.destino !== 'puesto') {
    fallos.push(`el destino es «${leccion.parametros.destino}» y no el puesto`);
  }
  if (leccion.parametros.valor !== leccion.linea) {
    fallos.push('lo que se guarda no es lo que se enseña en el prompt');
  }
  if (contieneDatosPersonales(leccion.linea)) {
    fallos.push('la lección contiene datos personales');
  }
  if (!leccion.linea.includes(debeConservar)) {
    fallos.push(`la lección no recoge lo que escribió la persona («${debeConservar}»)`);
  }
  if (leccion.linea.length > MAXIMO_LARGO_LINEA) {
    fallos.push(`la lección mide ${leccion.linea.length} caracteres`);
  }
  const superado = fallos.length === 0;
  return {
    id: CASO_APRENDIZAJE,
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? `${CASO_APRENDIZAJE}: superado`
      : `${CASO_APRENDIZAJE}: ${fallos.join('; ')}`,
  };
}

export function ejecutarCasoAprendizaje(): ResultadoEval {
  const cambios = diferenciaDeBorradores(EDICION.antes, EDICION.despues);
  const leccion = redactarLeccion(cambios, EDICION);
  return evaluarLeccion(leccion, EDICION.debeConservar);
}

/** Comprueba la memoria candidata entera, no solo la lección nueva. */
export function evaluarMemoriaCandidata(candidata: VersionCandidata): ResultadoEval {
  const fallos: string[] = [];
  const lineas = candidata.memoria.lineas;
  if (!(CLASES_LECCION as readonly string[]).includes(candidata.parametros.clase)) {
    fallos.push(`clase «${candidata.parametros.clase}» fuera del ADR-005`);
  }
  if (candidata.parametros.clase !== 'memoria') {
    fallos.push('v0 solo promociona lecciones de memoria');
  }
  if (lineas.length > MAXIMO_LINEAS_MEMORIA) {
    fallos.push(`la memoria tendría ${lineas.length} líneas`);
  }
  lineas.forEach((linea, i) => {
    if (contieneDatosPersonales(linea.texto))
      fallos.push(`la línea ${i + 1} tiene datos personales`);
    if (linea.texto.length > MAXIMO_LARGO_LINEA)
      fallos.push(`la línea ${i + 1} es demasiado larga`);
  });
  if (new Set(lineas.map((l) => l.leccionId)).size !== lineas.length) {
    fallos.push('una lección aparece dos veces en la memoria');
  }
  const superado = fallos.length === 0;
  return {
    id: 'memoria-candidata',
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? 'memoria-candidata: superado'
      : `memoria-candidata: ${fallos.join('; ')}`,
  };
}

/**
 * Puerta del Evaluador para una promoción. Certifica solo si todo pasa: los casos
 * dorados de los puestos no bajan y la memoria candidata respeta las reglas.
 */
export const certificarPromocion: PuertaDeEvaluacion = (candidata): ResultadoDeLaPuerta => {
  const casos = [
    ejecutarCasoCobros(),
    ejecutarCasoConciliacion(),
    ejecutarCasoAprendizaje(),
    evaluarMemoriaCandidata(candidata),
  ].map((resultado) => ({ ...resultado }));
  return {
    certificada: casos.every((caso) => caso.superado),
    evaluador: EVALUADOR,
    casos,
  };
};
