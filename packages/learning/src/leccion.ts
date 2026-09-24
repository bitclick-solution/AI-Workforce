/**
 * Redacción de la lección candidata a partir de una edición.
 *
 * En v0 es una plantilla determinista, sin modelo: coste cero, reproducible en la
 * integración continua y fácil de revisar por la persona que promociona. Lo que
 * sale es una línea de memoria que el prompt de la versión siguiente incluye bajo
 * «Lo que ya sabes».
 *
 * La lección se acota a las cuatro clases del ADR-005. Esta rebanada solo produce
 * `memoria`; las otras tres se aceptan en el esquema, pero `modelo_base` o cualquier
 * cosa fuera de la lista se rechaza antes de escribir.
 */
import { esquemas } from '@aiw/domain';

import { sanearTexto, type ClaseDatoPersonal } from './datos-personales.js';
import type { Cambio } from './diferencia.js';

/** Clases de lección permitidas por el ADR-005. Nunca el modelo base. */
export const CLASES_LECCION = ['memoria', 'habilidad', 'parametro', 'ejemplo'] as const;

/** Largo máximo de cada fragmento citado: una lección es una línea, no un correo. */
export const LARGO_CITA = 160;

/** Cuántos cambios cita una lección como mucho. El resto se cuenta, no se cita. */
export const CAMBIOS_CITADOS = 3;

export interface LeccionRedactada {
  titulo: string;
  /** La línea de memoria, ya saneada. Es lo que entra en el prompt. */
  linea: string;
  parametros: esquemas.ParametrosLeccion;
  /** Clases de dato personal que se quitaron. Sin valores. */
  datosPersonalesQuitados: ClaseDatoPersonal[];
}

export interface ContextoDeLeccion {
  /** Tipo del borrador opaco, p. ej. `herramienta.redactar_nota`. */
  tipoBorrador: string;
  claseAccion: string;
}

function citar(valor: unknown): string {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  const plano = (texto ?? '').replace(/\s+/g, ' ').trim();
  return plano.length > LARGO_CITA ? `${plano.slice(0, LARGO_CITA - 1)}…` : plano;
}

function describir(cambio: Cambio): string {
  if (!('antes' in cambio)) return `añadió ${cambio.ruta} = «${citar(cambio.despues)}»`;
  if (!('despues' in cambio)) return `quitó ${cambio.ruta} («${citar(cambio.antes)}»)`;
  return `cambió ${cambio.ruta} de «${citar(cambio.antes)}» a «${citar(cambio.despues)}»`;
}

/**
 * Convierte los cambios de una edición en una lección de memoria.
 *
 * Lanza si no hay cambios: una «edición» idéntica al borrador no enseña nada, y
 * proponer una lección vacía sería ruido para la persona que promociona.
 */
export function redactarLeccion(
  cambios: readonly Cambio[],
  contexto: ContextoDeLeccion,
): LeccionRedactada {
  if (cambios.length === 0) {
    throw new Error('La edición no cambió nada del borrador: no hay lección que proponer.');
  }
  const citados = cambios.slice(0, CAMBIOS_CITADOS).map(describir);
  const resto = cambios.length - citados.length;
  const cola = resto > 0 ? ` (y ${resto} cambio${resto === 1 ? '' : 's'} más)` : '';
  const bruta =
    `En ${contexto.tipoBorrador}, la persona ${citados.join('; ')}${cola}. ` +
    'Redacta así la próxima vez.';
  const saneada = sanearTexto(bruta);

  const parametros = validarParametros({
    clase: 'memoria',
    destino: 'puesto',
    valor: saneada.texto,
  });

  return {
    titulo: `Corrección en ${contexto.tipoBorrador} (${contexto.claseAccion})`,
    linea: saneada.texto,
    parametros,
    datosPersonalesQuitados: saneada.hallados,
  };
}

/**
 * Valida los parámetros de una lección contra el esquema del dominio y las clases
 * del ADR-005. Es la última puerta antes de escribir en `leccion.parametros`.
 */
export function validarParametros(valor: unknown): esquemas.ParametrosLeccion {
  return esquemas.validarCarga(esquemas.parametrosLeccion, valor, 'leccion.parametros');
}
