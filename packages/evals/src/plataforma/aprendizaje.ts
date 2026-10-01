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

/** Más pasos o comprobaciones que esto en una habilidad es una que no cabe en un paso. */
export const MAXIMO_PASOS_HABILIDAD = 20;

/**
 * Comprueba la lista de habilidades congeladas candidata: la habilidad nueva tiene
 * casos y pasos, no repite nombre y no nombra ninguna herramienta fuera de la
 * lista blanca del puesto (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md,
 * decisión 4). No se pronuncia sobre el contenido normativo: eso lo certifican los
 * casos dorados propios de cada habilidad, no esta función genérica.
 */
export function evaluarHabilidadCandidata(candidata: VersionCandidata): ResultadoEval {
  const fallos: string[] = [];
  if (candidata.parametros.clase !== 'habilidad') {
    fallos.push('esta comprobación es solo para promociones de clase «habilidad»');
  }
  const habilidades = candidata.habilidadesCongeladas ?? [];
  const nombres = habilidades.map((habilidad) => habilidad.nombre);
  if (new Set(nombres).size !== nombres.length) {
    fallos.push('una habilidad aparece dos veces en las habilidades congeladas');
  }
  const nueva = habilidades.find((habilidad) => habilidad.nombre === candidata.parametros.destino);
  if (!nueva) {
    fallos.push(`la habilidad «${candidata.parametros.destino}» no está en la candidata`);
  } else {
    if (nueva.casosQueAplican.length === 0) {
      fallos.push(`«${nueva.nombre}» no declara ningún caso que aplica`);
    }
    if (nueva.pasos.length === 0) {
      fallos.push(`«${nueva.nombre}» no declara ningún paso`);
    }
    if (nueva.pasos.length > MAXIMO_PASOS_HABILIDAD) {
      fallos.push(`«${nueva.nombre}» tendría ${nueva.pasos.length} pasos`);
    }
    const listaBlanca = new Set(candidata.listaBlancaHerramientas ?? []);
    const fueraDeLista = nueva.herramientas.filter((herramienta) => !listaBlanca.has(herramienta));
    if (fueraDeLista.length > 0) {
      fallos.push(
        `«${nueva.nombre}» nombra herramientas fuera de la lista blanca del puesto: ` +
          fueraDeLista.join(', '),
      );
    }
    if (
      contieneDatosPersonales(nueva.pasos.join(' ')) ||
      contieneDatosPersonales(nueva.comprobaciones.join(' '))
    ) {
      fallos.push(`«${nueva.nombre}» tiene datos personales en su cuerpo`);
    }
  }
  const superado = fallos.length === 0;
  return {
    id: 'habilidad-candidata',
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? 'habilidad-candidata: superado'
      : `habilidad-candidata: ${fallos.join('; ')}`,
  };
}

/**
 * Puerta del Evaluador para una promoción. Certifica solo si todo pasa: los casos
 * dorados de los puestos no bajan (criterio 8 de la especificación) y, según la
 * clase de la lección, la memoria candidata o las habilidades candidatas respetan
 * sus reglas. Las dos evaluaciones son mutuamente excluyentes: una promoción es de
 * una clase o de otra, nunca de las dos.
 */
export const certificarPromocion: PuertaDeEvaluacion = (candidata): ResultadoDeLaPuerta => {
  const casos = [
    ejecutarCasoCobros(),
    ejecutarCasoConciliacion(),
    ejecutarCasoAprendizaje(),
    candidata.parametros.clase === 'habilidad'
      ? evaluarHabilidadCandidata(candidata)
      : evaluarMemoriaCandidata(candidata),
  ].map((resultado) => ({ ...resultado }));
  return {
    certificada: casos.every((caso) => caso.superado),
    evaluador: EVALUADOR,
    casos,
  };
};
