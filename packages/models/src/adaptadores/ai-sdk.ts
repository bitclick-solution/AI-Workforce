/**
 * Adaptador de AI SDK: pasarela para Mistral, modelos locales y el proveedor
 * determinista de la integración continua (ADR-002, enmienda del ADR-017). No es la
 * ruta de Anthropic: Opus 5, Sonnet 5 y Haiku 4.5 solo hablan por Bedrock o Vertex
 * (`anthropic.ts`), nunca por aquí.
 *
 * El adaptador recibe el `LanguageModel` ya construido —`mistral('mistral-large-latest')`,
 * un proveedor compatible con OpenAI para un modelo local, o un
 * `MockLanguageModelV4` de `ai/test` para la integración continua— y no sabe cuál
 * de los tres es: la elección del modelo es de quien lo instala, igual que con los
 * clientes de `clientes.ts`.
 *
 * Sin esfuerzo por clase de paso: ninguno de estos proveedores tiene un parámetro de
 * razonamiento adaptativo equivalente al de Anthropic (documentado en el runbook de
 * funciones ausentes). Esta ruta es para los pasos baratos o deterministas, no para
 * el razonamiento financiero ni la conciliación, que van por la ruta de Anthropic.
 */
import type { LanguageModel } from 'ai';
import { generateText, Output } from 'ai';

import type {
  PeticionDeModelo,
  PuertoDeModelo,
  RespuestaDeModelo,
  TokensDeUso,
} from '../puerto.js';

export interface OpcionesAdaptadorAiSdk {
  /** Identificador de modelo tal como lo registra el contador: `mistral-large-latest`, `llama-3-3-70b`, etc. */
  modelo: string;
}

function aTokensDeUso(usage: {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  inputTokenDetails: { cacheReadTokens: number | undefined };
}): TokensDeUso {
  return {
    entrada: usage.inputTokens ?? 0,
    salida: usage.outputTokens ?? 0,
    entradaCache: usage.inputTokenDetails.cacheReadTokens ?? 0,
  };
}

/** Crea un puerto de modelo sobre el AI SDK. La plataforma siempre es `ai-sdk` (ADR-017). */
export function crearAdaptadorAiSdk(
  modeloLm: LanguageModel,
  opciones: OpcionesAdaptadorAiSdk,
): PuertoDeModelo {
  return {
    modelo: opciones.modelo,
    plataforma: 'ai-sdk',
    async completar<T>(peticion: PeticionDeModelo<T>): Promise<RespuestaDeModelo<T>> {
      const resultado = await generateText({
        model: modeloLm,
        ...(peticion.sistema !== undefined ? { system: peticion.sistema } : {}),
        messages: peticion.mensajes.map((mensaje) => ({
          role: mensaje.rol,
          content: mensaje.contenido,
        })),
        ...(peticion.esquemaSalida
          ? { output: Output.object({ schema: peticion.esquemaSalida }) }
          : {}),
      });

      const tokens = aTokensDeUso(resultado.usage);

      // Sin categorías de rechazo propias del proveedor: `content-filter` es lo más
      // parecido al rechazo del clasificador de Anthropic (ADR-018).
      if (resultado.finishReason === 'content-filter') {
        return {
          tipo: 'rechazo',
          categoria: null,
          explicacion: 'El proveedor de AI SDK filtró la respuesta por contenido.',
          tokens,
          modelo: opciones.modelo,
        };
      }

      return {
        tipo: 'ok',
        texto: resultado.text,
        ...(peticion.esquemaSalida ? { salida: resultado.output as T } : {}),
        tokens,
        modelo: opciones.modelo,
      };
    },
  };
}
