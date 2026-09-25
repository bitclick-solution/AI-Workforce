/**
 * Identificadores de modelo por papel y por plataforma (ADR-017, ADR-018).
 *
 * El papel es vocabulario del negocio (`@aiw/domain`): Opus 5 para razonamiento y
 * escrituras, Sonnet 5 por defecto, Haiku 4.5 para moderador/clasificación/rutinas.
 * El identificador real cambia con la plataforma —Bedrock lleva el prefijo
 * `anthropic.`, Vertex y la primera parte llevan el identificador desnudo, nunca
 * con fecha (ADR-018)— y solo vive aquí: el resto del paquete solo conoce papeles.
 */
import type { PapelModelo, PlataformaModelo } from '@aiw/domain';

/** Identificador desnudo, igual en primera parte y en Vertex (ADR-018: nunca con fecha). */
const IDENTIFICADOR_DESNUDO: Record<PapelModelo, string> = {
  opus5: 'claude-opus-5',
  sonnet5: 'claude-sonnet-5',
  haiku45: 'claude-haiku-4-5',
};

/**
 * Resuelve el identificador de modelo que espera cada plataforma para un papel.
 *
 * `ai-sdk` no tiene un identificador de Anthropic: esa plataforma enruta a
 * Mistral, a un modelo local o al proveedor determinista de la integración
 * continua, y el identificador lo decide quien construye el adaptador de AI SDK,
 * no esta tabla.
 */
export function identificadorDeModelo(papel: PapelModelo, plataforma: PlataformaModelo): string {
  if (plataforma === 'ai-sdk') {
    throw new Error(
      `La plataforma "ai-sdk" no tiene identificador de Anthropic para el papel "${papel}": ` +
        'la resuelve el adaptador de AI SDK con su propio catálogo de modelos.',
    );
  }
  const desnudo = IDENTIFICADOR_DESNUDO[papel];
  if (plataforma === 'bedrock-eu') return `anthropic.${desnudo}`;
  return desnudo;
}

/** El nombre canónico de un papel, tal como se registra en el contador (`modelo`). */
export function nombreCanonico(papel: PapelModelo): string {
  return IDENTIFICADOR_DESNUDO[papel];
}
