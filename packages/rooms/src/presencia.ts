/**
 * Cálculo de presencia de la sala v1 (ADR-022): en qué estado se pinta cada
 * miembro. Función pura, sin E/S: recibe lo que ya existe en el instante en que se
 * pinta la sala y decide.
 *
 * La presencia de las personas no se guarda —ni historial ni entrada en el
 * libro (docs/adr/ADR-022.md, rebanada «Sala v1»)—: `conectada`, `ultimaActividadMs`
 * y `escribiendoHastaMs` los da quien llama, a partir de la presencia en vivo de
 * Centrifugo y de las publicaciones efímeras de «escribiendo». El estado de un
 * agente, en cambio, se deriva de lo que ya existe en PostgreSQL: su tarea en
 * curso, una aprobación pendiente dirigida a una persona y el estado de su puesto.
 */

/** Los siete estados de la hoja del lienzo del ADR-022. */
export type EstadoDePresencia =
  'en-la-sala' | 'escribiendo' | 'inactivo' | 'anadido' | 'trabajando' | 'te-necesita' | 'en-pausa';

/** Sin actividad diez minutos, la persona pasa a inactiva (propuesta de la rebanada). */
export const UMBRAL_INACTIVIDAD_MS = 10 * 60 * 1000;

/** Cuánto dura una publicación efímera de «escribiendo» antes de caducar. */
export const DURACION_ESCRIBIENDO_MS = 6_000;

export interface EntradaPresenciaPersona {
  tipo: 'persona';
  /** Si Centrifugo la ve conectada a la sala ahora mismo. */
  conectada: boolean;
  /** Época en milisegundos de su última actividad conocida; nulo si acaba de entrar. */
  ultimaActividadMs: number | null;
  ahoraMs: number;
  /** Época hasta la que su última publicación de «escribiendo» sigue vigente. */
  escribiendoHastaMs?: number | null | undefined;
}

/**
 * Estado de puesto, tal como lo guarda `puesto.estado` (`@aiw/domain`). No se
 * importa el tipo desde `@aiw/domain` a propósito: `packages/rooms` no depende en
 * valor de ese paquete, y una cadena que no encaja con ninguna regla cae al
 * resultado por defecto en vez de romper la función.
 */
export type EstadoDePuestoParaPresencia = string;

export interface EntradaPresenciaAgente {
  tipo: 'agente';
  estadoPuesto: EstadoDePuestoParaPresencia;
  /** Si el puesto tiene una tarea en curso ahora mismo. */
  tareaEnCurso: boolean;
  /** Si alguna de sus tareas espera una aprobación de una persona. */
  aprobacionPendiente: boolean;
  ahoraMs: number;
  escribiendoHastaMs?: number | null | undefined;
}

export type EntradaPresencia = EntradaPresenciaPersona | EntradaPresenciaAgente;

function escribiendoVigente(entrada: EntradaPresencia): boolean {
  const hasta = entrada.escribiendoHastaMs;
  return typeof hasta === 'number' && hasta > entrada.ahoraMs;
}

/**
 * Deriva el estado de un agente de lo que ya existe: tarea en curso, aprobación
 * pendiente de una persona y puesto pausado (encargo de la rebanada). El orden
 * importa y es el que pinta mejor la sala: un puesto pausado lo dice todo primero,
 * necesitar a alguien pesa más que estar trabajando, y solo si nada de eso aplica
 * se mira si el puesto ni siquiera ha arrancado (`propuesto`, «añadido») o lleva
 * tiempo sin tarea (`degradado`, «inactivo»). `en_prueba` y `activo` sin trabajo
 * pendiente son la sala en reposo: «en la sala».
 */
function estadoDeAgente(entrada: EntradaPresenciaAgente): EstadoDePresencia {
  if (entrada.estadoPuesto === 'pausado') return 'en-pausa';
  if (entrada.aprobacionPendiente) return 'te-necesita';
  if (entrada.tareaEnCurso) return 'trabajando';
  if (entrada.estadoPuesto === 'propuesto') return 'anadido';
  if (entrada.estadoPuesto === 'degradado') return 'inactivo';
  return 'en-la-sala';
}

/**
 * Deriva el estado de una persona: en la sala con el panel abierto, inactiva a
 * los diez minutos sin actividad y añadida si es miembro sin conexión (criterios
 * de hecho de la rebanada).
 */
function estadoDePersona(entrada: EntradaPresenciaPersona): EstadoDePresencia {
  if (!entrada.conectada) return 'anadido';
  if (entrada.ultimaActividadMs === null) return 'en-la-sala';
  const inactiva = entrada.ahoraMs - entrada.ultimaActividadMs >= UMBRAL_INACTIVIDAD_MS;
  return inactiva ? 'inactivo' : 'en-la-sala';
}

export function calcularEstadoDePresencia(entrada: EntradaPresencia): EstadoDePresencia {
  if (escribiendoVigente(entrada)) return 'escribiendo';
  return entrada.tipo === 'agente' ? estadoDeAgente(entrada) : estadoDePersona(entrada);
}
