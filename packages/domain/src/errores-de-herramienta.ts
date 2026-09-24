/**
 * Cómo la plataforma interpreta el fallo de una herramienta.
 *
 * El contrato de herramientas de AI Workforce —el que cumplen el conector de Odoo y
 * el de demostración— dice que un fallo viaja como resultado de herramienta con
 * `isError`, y que su cuerpo lleva `code`, `message` en español y `datos.motivo`
 * con uno de cuatro valores. De los tres campos, el único que la plataforma
 * interpreta es el motivo: el código sirve para agrupar en la auditoría y el mensaje
 * para que lo lea una persona.
 *
 * Esta lista vive aquí y no en el gateway porque decide algo de negocio: si una
 * acción se reintenta. Cada conector la escribe por su lado —un servidor MCP es un
 * programa independiente y no puede importar este paquete—, así que lo que hay aquí
 * es el lado de la plataforma del mismo acuerdo. La duplicación son cuatro cadenas
 * y está documentada en `connectors/demo/README.md`.
 */
import { z } from 'zod';

/**
 * Por qué falló una herramienta.
 *
 * - `no_encontrada`: el dato que se pedía no existe. Insistir no lo crea.
 * - `no_autorizado`: la credencial no da para esto. Insistir tampoco.
 * - `temporal`: el sistema de destino no puede ahora. Se reintenta.
 * - `invalido`: los argumentos no valen. Los tiene que cambiar quien llama.
 */
export const MOTIVOS_ERROR_HERRAMIENTA = [
  'no_encontrada',
  'no_autorizado',
  'temporal',
  'invalido',
] as const;

export type MotivoErrorHerramienta = (typeof MOTIVOS_ERROR_HERRAMIENTA)[number];

/** El único motivo que mejora al insistir. */
export const MOTIVO_REINTENTABLE: MotivoErrorHerramienta = 'temporal';

export const errorDeHerramienta = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  datos: z.object({ motivo: z.enum(MOTIVOS_ERROR_HERRAMIENTA) }),
});

export type ErrorDeHerramienta = z.infer<typeof errorDeHerramienta>;

/**
 * Lee el error del contrato de un texto de resultado.
 *
 * Devuelve `undefined` cuando el texto no lo cumple: un servidor MCP de terceros
 * puede contestar lo que quiera, y entonces la plataforma no sabe si conviene
 * reintentar. Quien decide en ese caso es quien llama, no esta función.
 */
export function leerErrorDeHerramienta(texto: string): ErrorDeHerramienta | undefined {
  try {
    const resultado = errorDeHerramienta.safeParse(JSON.parse(texto));
    return resultado.success ? resultado.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Si conviene reintentar.
 *
 * Un motivo desconocido se reintenta. Es la decisión prudente: lo más probable es
 * que un fallo que no sigue el contrato sea de red o del transporte, y esos pasan.
 * Los tres motivos que no se reintentan son los que el conector afirma que no van a
 * cambiar por insistir.
 */
export function esReintentable(motivo: MotivoErrorHerramienta | undefined): boolean {
  return motivo === undefined || motivo === MOTIVO_REINTENTABLE;
}
