/**
 * Forma mínima que necesita el adaptador de Anthropic: un `messages.create` con la
 * forma de la API de Mensajes.
 *
 * `AnthropicBedrock` (integración clásica), `AnthropicBedrockMantle` (endpoint de
 * Mensajes), `AnthropicVertex` y el `Anthropic` de primera parte exponen los cuatro
 * esta misma superficie (documentado en la guía de clientes por plataforma): el
 * adaptador no distingue entre ellos, así que el mismo código sirve las dos vías de
 * Bedrock, Vertex, primera parte y un cliente simulado en las pruebas.
 */
import type Anthropic from '@anthropic-ai/sdk';

export interface ClienteDeMensajes {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}
