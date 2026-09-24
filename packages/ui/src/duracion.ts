import type { Traductor } from './i18n';

export interface DuracionDescompuesta {
  horas: number;
  minutos: number;
  segundos: number;
}

/** Descompone milisegundos en horas, minutos y segundos. Los negativos cuentan como cero. */
export function descomponerDuracion(milisegundos: number): DuracionDescompuesta {
  const totalSegundos = Math.max(0, Math.floor(milisegundos / 1000));
  return {
    horas: Math.floor(totalSegundos / 3600),
    minutos: Math.floor((totalSegundos % 3600) / 60),
    segundos: totalSegundos % 60,
  };
}

/**
 * Duración legible: «9 min 12 s», «1 h 4 min 0 s», «0 s».
 * Las unidades salen del diccionario, así que la cadena se traduce.
 */
export function formatearDuracion(milisegundos: number, t: Traductor): string {
  const { horas, minutos, segundos } = descomponerDuracion(milisegundos);
  const partes: string[] = [];
  if (horas > 0) partes.push(t('ui.duracion.horas', { valor: horas }));
  if (horas > 0 || minutos > 0) partes.push(t('ui.duracion.minutos', { valor: minutos }));
  partes.push(t('ui.duracion.segundos', { valor: segundos }));
  return partes.join(' ');
}
