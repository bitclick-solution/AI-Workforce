/**
 * Errores del conector.
 *
 * Todo fallo sale como error MCP con `code`, `message` en español y
 * `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`.
 * Solo `temporal` es reintentable.
 */

export const MOTIVOS = ['no_encontrada', 'no_autorizado', 'temporal', 'invalido'] as const;

export type Motivo = (typeof MOTIVOS)[number];

/**
 * Códigos JSON-RPC. `invalido` reutiliza el código estándar de parámetros
 * inválidos; los otros tres usan el rango reservado a la implementación.
 */
export const CODIGO_POR_MOTIVO: Record<Motivo, number> = {
  invalido: -32602,
  no_encontrada: -32004,
  no_autorizado: -32003,
  temporal: -32002,
};

/** Un motivo y solo uno es reintentable: el que dice que el fallo pasará. */
export function esReintentable(motivo: Motivo): boolean {
  return motivo === 'temporal';
}

export class ErrorConector extends Error {
  readonly motivo: Motivo;
  readonly codigo: number;
  readonly reintentable: boolean;

  constructor(motivo: Motivo, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorConector';
    this.motivo = motivo;
    this.codigo = CODIGO_POR_MOTIVO[motivo];
    this.reintentable = esReintentable(motivo);
  }

  /** Lo que viaja en `datos` del error MCP. Nunca lleva credenciales. */
  get datos(): { motivo: Motivo; reintentable: boolean } {
    return { motivo: this.motivo, reintentable: this.reintentable };
  }
}

const PATRONES: readonly (readonly [Motivo, RegExp])[] = [
  ['no_encontrada', /no se ha encontrado|no encontrad[oa]|not found|no existe|does not exist/i],
  [
    'no_autorizado',
    /unauthori[sz]ed|forbidden|\b40[13]\b|no autorizad|permiso|scope|token (inv[aá]lido|caducado|expirado)|invalid token|expired|firma/i,
  ],
  [
    'temporal',
    /timeout|timed out|etimedout|econnrefused|econnreset|enotfound|socket|fetch failed|network|temporarily|unavailable|circuit|rate.?limit|demasiadas|redis|\b50[234]\b/i,
  ],
  ['invalido', /validation|inv[aá]lid|obligatorio|required|formato/i],
];

/**
 * Traduce el fallo de Factusol MCP a uno de los cuatro motivos.
 *
 * Lo que no encaja en ningún patrón se declara `temporal`: reintentar un fallo
 * permanente solo retrasa el mismo error, mientras que declarar permanente un
 * fallo pasajero para la tarea con un diagnóstico equivocado.
 */
export function motivoDeMensaje(mensaje: string): Motivo {
  for (const [motivo, patron] of PATRONES) {
    if (patron.test(mensaje)) return motivo;
  }
  return 'temporal';
}

/** Lo que cabe de un texto ajeno en un mensaje de error del conector. */
export const LIMITE_DETALLE = 300;

/**
 * Recorta el detalle que viene de Factusol antes de meterlo en un mensaje.
 *
 * Un fallo de Factusol puede traer una traza entera con detalle interno. Eso no tiene por qué llegar al contexto del modelo ni a los
 * registros de aguas abajo, así que se queda en la primera línea y en
 * `LIMITE_DETALLE` caracteres. Quien necesite la traza completa la tiene en
 * Factusol MCP, que es donde se produjo.
 */
export function recortarDetalle(texto: string, limite = LIMITE_DETALLE): string {
  const primeraLinea = texto.split('\n', 1)[0] ?? '';
  const limpio = primeraLinea.replace(/\s+/g, ' ').trim();
  return limpio.length > limite ? `${limpio.slice(0, limite)}…` : limpio;
}

/** Convierte cualquier excepción en `ErrorConector`, conservando el motivo si ya lo tenía. */
export function traducirError(error: unknown, contexto: string): ErrorConector {
  if (error instanceof ErrorConector) return error;
  const mensaje = error instanceof Error ? error.message : String(error);
  return new ErrorConector(motivoDeMensaje(mensaje), `${contexto}: ${recortarDetalle(mensaje)}`);
}
