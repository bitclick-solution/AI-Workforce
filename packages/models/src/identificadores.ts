/**
 * Identificadores de modelo por papel y por plataforma (ADR-017, ADR-018).
 *
 * El papel es vocabulario del negocio (`@aiw/domain`): Opus 5 para razonamiento y
 * escrituras, Sonnet 5 por defecto, Haiku 4.5 para moderador/clasificación/rutinas.
 * El identificador real cambia con la plataforma —Bedrock lleva el prefijo
 * `anthropic.`, Vertex y la primera parte llevan el identificador desnudo, nunca
 * con fecha (ADR-018)— y solo vive aquí: el resto del paquete solo conoce papeles.
 *
 * Resolución provisional (decisión de Jesús, 2026-09-25): Bedrock en Frankfurt
 * todavía no tiene cuota concedida para Opus 5 ni para Sonnet 5. Mientras llega,
 * esos dos papeles se sirven en Bedrock con la familia 4.6 (Haiku 4.5 no cambia,
 * ya está disponible). El papel que guarda la versión de puesto sigue siendo
 * `opus5`/`sonnet5` (ADR-018): el cambio a la familia 5, cuando Bedrock conceda la
 * cuota, es retirar esta tabla, no una promoción de ninguna versión de puesto — la
 * versión de puesto nunca supo que estaba en modo provisional.
 */
import type { PapelModelo, PlataformaModelo } from '@aiw/domain';

/** Identificador desnudo objetivo del papel (ADR-018): nunca con fecha. */
const IDENTIFICADOR_DESNUDO_OBJETIVO: Record<PapelModelo, string> = {
  opus5: 'claude-opus-5',
  sonnet5: 'claude-sonnet-5',
  haiku45: 'claude-haiku-4-5',
};

/**
 * Sustitución provisional en Bedrock mientras no hay cuota para la familia 5
 * (decisión de Jesús, 2026-09-25). Solo Bedrock: no hay indicio de que Vertex ni
 * la primera parte tengan la misma limitación, así que ahí se sigue pidiendo la
 * familia 5 objetivo.
 */
const IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK: Partial<Record<PapelModelo, string>> = {
  opus5: 'claude-opus-4-6',
  sonnet5: 'claude-sonnet-4-6',
};

function identificadorDesnudo(papel: PapelModelo, plataforma: PlataformaModelo): string {
  if (plataforma === 'bedrock-eu') {
    return (
      IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK[papel] ?? IDENTIFICADOR_DESNUDO_OBJETIVO[papel]
    );
  }
  return IDENTIFICADOR_DESNUDO_OBJETIVO[papel];
}

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
  const desnudo = identificadorDesnudo(papel, plataforma);
  if (plataforma === 'bedrock-eu') return `anthropic.${desnudo}`;
  return desnudo;
}

/**
 * `true` cuando el papel, en esa plataforma, lo sirve hoy un sustituto provisional
 * en vez del modelo objetivo del ADR-018 (por ejemplo, Opus 4.6 en Bedrock en vez
 * de Opus 5). Lo usa el adaptador para ajustar lo que el modelo provisional no
 * admite todavía (`anthropic.ts`: el esfuerzo `xhigh`, que llegó con Opus 4.7).
 */
export function esProvisional(papel: PapelModelo, plataforma: PlataformaModelo): boolean {
  return plataforma === 'bedrock-eu' && papel in IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK;
}

/** El nombre canónico de un papel, tal como se registra en el contador (`modelo`). Es el objetivo del ADR-018, no la sustitución provisional. */
export function nombreCanonico(papel: PapelModelo): string {
  return IDENTIFICADOR_DESNUDO_OBJETIVO[papel];
}
