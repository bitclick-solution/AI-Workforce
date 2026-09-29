/**
 * Puerto de modelo: lo que el bucle del agente necesita de un modelo, sin saber si
 * lo sirve Bedrock, Vertex o el AI SDK (ADR-017).
 *
 * Un `PuertoDeModelo` completa una petición y devuelve un resultado. El rechazo del
 * clasificador (ADR-018) no es una excepción: es un resultado válido, porque es un
 * paso fallido no reintentable que hay que anotar en el libro con su categoría, no
 * un error de transporte que reintentar solo. Un error de transporte (red, límite
 * de tasa, 5xx) sí se lanza: eso lo reintenta Temporal.
 */
import type { ClasePaso } from '@aiw/domain';
import type { z } from 'zod';

export type MensajeRol = 'user' | 'assistant';

export interface MensajeDeModelo {
  rol: MensajeRol;
  contenido: string;
}

export interface HerramientaDeModelo {
  nombre: string;
  descripcion: string;
  /** Esquema Zod de la entrada. Se traduce a JSON Schema estricto (ADR-018: sin instrucción suelta). */
  esquemaEntrada: z.ZodType;
}

/**
 * Llamada a una herramienta que hizo el modelo, con la entrada ya validada contra
 * el esquema Zod original de `HerramientaDeModelo.esquemaEntrada` — el esquema que
 * viaja en la petición (`anthropic.ts`) le ha quitado las palabras clave que la API
 * no admite con `strict` (restricciones numéricas, de longitud de cadena o de
 * array), así que esa parte del contrato no la hace cumplir la API: la vuelve a
 * comprobar el adaptador al recibir la llamada.
 */
export interface LlamadaHerramienta {
  /** Nombre de la herramienta, tal como se declaró en `herramientas`. */
  nombre: string;
  /** Entrada ya validada (`esquemaEntrada.safeParse`), no el JSON crudo del modelo. */
  entrada: unknown;
}

export interface PeticionDeModelo<T = unknown> {
  /** Clase de paso del bucle del agente (ADR-018): decide el esfuerzo si la petición no lo fija. */
  clasePaso: ClasePaso;
  sistema?: string | undefined;
  mensajes: MensajeDeModelo[];
  herramientas?: HerramientaDeModelo[] | undefined;
  /**
   * Esquema de la salida estructurada. Cuando se da, la respuesta es siempre
   * `{ tipo: 'ok', salida: T, ... }` con `salida` validada contra este esquema, o un
   * `{ tipo: 'rechazo', ... }`; nunca texto libre a medio validar.
   */
  esquemaSalida?: z.ZodType<T> | undefined;
  maxTokens?: number | undefined;
}

export interface TokensDeUso {
  entrada: number;
  salida: number;
  entradaCache?: number | undefined;
}

/** Categorías de rechazo del clasificador, tal como las expone la API de Mensajes. */
export type CategoriaRechazo =
  'cyber' | 'bio' | 'frontier_llm' | 'reasoning_extraction' | 'general_harms' | null;

export interface RespuestaDeModeloOk<T = unknown> {
  tipo: 'ok';
  texto: string;
  /** Presente solo cuando la petición llevaba `esquemaSalida`. */
  salida?: T | undefined;
  /** Presente solo cuando el modelo pidió alguna de las `herramientas` de la petición. */
  llamadasHerramientas?: readonly LlamadaHerramienta[] | undefined;
  tokens: TokensDeUso;
  modelo: string;
}

/**
 * Rechazo del clasificador: paso fallido no reintentable (ADR-018). Se anota en el
 * libro con `categoria` y no se reintenta con el mismo modelo; el respaldo, si lo
 * hay, lo decide la política del puesto y lo ejecuta el cliente (`respaldo.ts`).
 */
export interface RespuestaDeModeloRechazo {
  tipo: 'rechazo';
  categoria: CategoriaRechazo;
  explicacion: string | null;
  /** Tokens consumidos hasta el rechazo: un rechazo a mitad de flujo se factura igual. */
  tokens: TokensDeUso;
  modelo: string;
}

export type RespuestaDeModelo<T = unknown> = RespuestaDeModeloOk<T> | RespuestaDeModeloRechazo;

export interface PuertoDeModelo {
  /** Identificador de modelo que sirve este puerto, para auditoría y coste. */
  readonly modelo: string;
  /** Plataforma real que ejecuta la inferencia (ADR-017), para la tarifa y el panel. */
  readonly plataforma: string;
  completar<T = unknown>(peticion: PeticionDeModelo<T>): Promise<RespuestaDeModelo<T>>;
}
