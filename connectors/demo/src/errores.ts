/**
 * Errores del contrato de herramientas, iguales en los dos conectores.
 *
 * Un error de herramienta en MCP no es un error del protocolo: viaja como resultado
 * con `isError`, porque la llamada sí llegó y sí se atendió, y lo que falló es lo
 * que se pedía. Los errores del protocolo se reservan para lo que ni se entiende.
 *
 * El cuerpo lleva tres cosas y siempre las mismas: un `code` estable, un `message`
 * en español para la persona que lea la auditoría, y un `datos.motivo` que la
 * plataforma sí interpreta. Solo `temporal` se reintenta; los otros tres no, y por
 * eso el motivo tiene que ser un dato y no una frase que alguien tenga que leer.
 *
 * Los cuatro motivos están escritos también en `@aiw/domain`, que es el lado de la
 * plataforma del mismo acuerdo. No se importan de allí a propósito: un servidor MCP
 * es un programa independiente y un conector de terceros tampoco podría importarlo.
 * Lo que los mantiene sincronizados es el contrato del README y las pruebas.
 */

/** Por qué falló. Es el único campo del error que la plataforma interpreta. */
export const MOTIVOS_ERROR_DEMO = [
  'no_encontrada',
  'no_autorizado',
  'temporal',
  'invalido',
] as const;

export type MotivoError = (typeof MOTIVOS_ERROR_DEMO)[number];

/** El único motivo que se reintenta. Los demás no mejoran por insistir. */
export const MOTIVO_REINTENTABLE_DEMO: MotivoError = 'temporal';

/** Códigos estables del contrato. No se renombran: se añaden. */
export const CODIGOS_DEMO: Record<MotivoError, string> = {
  no_encontrada: 'FACTURA_NO_ENCONTRADA',
  no_autorizado: 'NO_AUTORIZADO',
  temporal: 'ERROR_TEMPORAL',
  invalido: 'ARGUMENTOS_NO_VALIDOS',
};

export interface CuerpoDeErrorDemo {
  code: string;
  message: string;
  datos: { motivo: MotivoError };
}

/** Resultado de herramienta con el error del contrato dentro. */
export interface ResultadoDeErrorDemo {
  isError: true;
  content: [{ type: 'text'; text: string }];
}

export function errorDeHerramienta(motivo: MotivoError, mensaje: string): ResultadoDeErrorDemo {
  const cuerpo: CuerpoDeErrorDemo = {
    code: CODIGOS_DEMO[motivo],
    message: mensaje,
    datos: { motivo },
  };
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(cuerpo) }] };
}

/**
 * Lee el motivo de un texto de error de herramienta.
 *
 * Devuelve `undefined` cuando el texto no es un error del contrato: un servidor MCP
 * de terceros puede devolver lo que quiera, y entonces la plataforma no puede saber
 * si conviene reintentar. En ese caso decide quien llama, no este módulo.
 */
export function motivoDelError(texto: string): MotivoError | undefined {
  try {
    const analizado: unknown = JSON.parse(texto);
    const motivo = (analizado as { datos?: { motivo?: unknown } }).datos?.motivo;
    return MOTIVOS_ERROR_DEMO.includes(motivo as MotivoError) ? (motivo as MotivoError) : undefined;
  } catch {
    return undefined;
  }
}

/** Si conviene reintentar. Un motivo desconocido se reintenta: puede ser de red. */
export function esReintentableDemo(motivo: MotivoError | undefined): boolean {
  return motivo === undefined || motivo === MOTIVO_REINTENTABLE_DEMO;
}
