/**
 * Máquina del recorrido del prototipo.
 *
 * Funciones puras: sellan hitos y calculan el tiempo del primer clic a la
 * primera tarea aprobada, que es el número que la experiencia de diez minutos
 * convierte en requisito de producto. Ninguna decisión de negocio vive aquí:
 * esto solo cuenta lo que la persona ya ha hecho.
 */

export const HITOS = [
  'primerClic',
  'agenteContratado',
  'intervencionPedida',
  'tareaAprobada',
] as const;

export type Hito = (typeof HITOS)[number];

export interface Recorrido {
  /** Marca de tiempo en milisegundos de cada hito alcanzado. */
  hitos: Partial<Record<Hito, number>>;
  /** Tareas consumidas por lo que la persona ha aprobado. */
  tareas: number;
  /** El ADR-005 llama a la edición la señal más valiosa: se registra aparte. */
  aprobadaConEdicion: boolean;
}

export const RECORRIDO_INICIAL: Recorrido = { hitos: {}, tareas: 0, aprobadaConEdicion: false };

/** Sella un hito. El primer sellado manda: repetir un paso no retrasa el reloj. */
export function sellar(recorrido: Recorrido, hito: Hito, ahora: number): Recorrido {
  if (recorrido.hitos[hito] !== undefined) return recorrido;
  return { ...recorrido, hitos: { ...recorrido.hitos, [hito]: ahora } };
}

export function sumarTareas(recorrido: Recorrido, tareas: number): Recorrido {
  return { ...recorrido, tareas: recorrido.tareas + Math.max(0, tareas) };
}

export function marcarEdicion(recorrido: Recorrido): Recorrido {
  return { ...recorrido, aprobadaConEdicion: true };
}

/** El tiempo que se mide. `null` mientras no haya primera tarea aprobada. */
export function duracionHastaAprobacion(recorrido: Recorrido): number | null {
  const inicio = recorrido.hitos.primerClic;
  const fin = recorrido.hitos.tareaAprobada;
  if (inicio === undefined || fin === undefined) return null;
  return Math.max(0, fin - inicio);
}

/** Tiempo transcurrido para el cronómetro en vivo. `null` antes del primer clic. */
export function transcurrido(recorrido: Recorrido, ahora: number): number | null {
  const inicio = recorrido.hitos.primerClic;
  if (inicio === undefined) return null;
  return Math.max(0, (recorrido.hitos.tareaAprobada ?? ahora) - inicio);
}

/** El siguiente hito pendiente, o `null` si el recorrido está completo. */
export function siguienteHito(recorrido: Recorrido): Hito | null {
  return HITOS.find((hito) => recorrido.hitos[hito] === undefined) ?? null;
}

export function estaCompleto(recorrido: Recorrido): boolean {
  return siguienteHito(recorrido) === null;
}
