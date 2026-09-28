/**
 * Identificadores de modelo por papel y por plataforma (ADR-017, ADR-018).
 *
 * El papel es vocabulario del negocio (`@aiw/domain`): Opus 5 para razonamiento y
 * escrituras, Sonnet 5 por defecto, Haiku 4.5 para moderador/clasificación/rutinas.
 * El identificador real cambia con la plataforma. En Vertex y en primera parte es
 * el identificador desnudo, nunca con fecha (ADR-018). En Bedrock UE depende del
 * camino: el endpoint de Mensajes (`bedrock-mantle`) usaría el identificador con
 * el prefijo `anthropic.`, pero hoy la cuenta no tiene acceso a ningún modelo de
 * Anthropic por ese camino en las regiones de la UE contratadas (403 «not
 * available for this account», comprobado el 2026-09-28); la integración clásica
 * (`bedrock-runtime`, cliente `AnthropicBedrock`) sí funciona, y en ella los
 * modelos se piden por un perfil de inferencia entre regiones con el prefijo
 * `eu.`, no por el identificador bajo demanda. Esta tabla vive solo aquí: el
 * resto del paquete solo conoce papeles.
 *
 * Resolución provisional en Bedrock UE (decisión de Jesús, 2026-09-25, revisada el
 * mismo día; identificadores del camino clásico confirmados el 2026-09-28): sin
 * acceso de la cuenta a ningún Opus ni a Sonnet 5, `opus5` y `sonnet5` se sirven
 * los dos con el perfil de inferencia UE de Sonnet 4.6
 * (`eu.anthropic.claude-sonnet-4-6`) —el mismo modelo, con esfuerzo alto para
 * `opus5` como suelo, porque hace el trabajo de razonamiento y de decisión de
 * escritura con un modelo que no es un Opus—. `haiku45` usa el perfil de
 * inferencia UE de Haiku 4.5, que Bedrock solo ofrece con fecha
 * (`eu.anthropic.claude-haiku-4-5-20251001-v1:0`): excepción anotada al «nunca con
 * fecha» del ADR-018, porque no es una sustitución de modelo, es la única forma
 * que expone la plataforma para ese modelo. Orden de preferencia para volver a un
 * Opus en cuanto haya cuota: Opus 5.5, Opus 5, Opus 4.6. Cuando AWS conceda acceso
 * al endpoint de Mensajes para la familia 5, retirar la fila de `bedrock-eu` de
 * esta tabla es lo único que hace falta aquí — ver
 * `docs/runbooks/modelos-funciones-ausentes.md`.
 *
 * El papel que guarda la versión de puesto sigue siendo `opus5`/`sonnet5`
 * (ADR-018): el cambio a la familia 5, cuando Bedrock conceda el acceso, es
 * retirar esta tabla, no una promoción de ninguna versión de puesto — la versión
 * de puesto nunca supo que estaba en modo provisional.
 */
import type { PapelModelo, PlataformaModelo } from '@aiw/domain';

/** Identificador desnudo objetivo del papel (ADR-018): nunca con fecha. Vertex y primera parte. */
const IDENTIFICADOR_DESNUDO_OBJETIVO: Record<PapelModelo, string> = {
  opus5: 'claude-opus-5',
  sonnet5: 'claude-sonnet-5',
  haiku45: 'claude-haiku-4-5',
};

/**
 * Sustitución provisional solo para `opus5`/`sonnet5`: `esfuerzoSoportado` en
 * `anthropic.ts` la usa para bajar `xhigh` a `high` y aplicar el suelo de esfuerzo
 * alto de `opus5`. `haiku45` no está aquí porque no tiene sustituto: sirve el
 * mismo modelo objetivo, solo que Bedrock lo expone con un identificador distinto
 * (perfil de inferencia UE con fecha, ver arriba).
 */
const PAPELES_CON_SUSTITUTO_PROVISIONAL_BEDROCK: ReadonlySet<PapelModelo> = new Set([
  'opus5',
  'sonnet5',
]);

/**
 * Identificadores del perfil de inferencia UE que ofrece hoy la integración
 * clásica de Bedrock (`aws bedrock-runtime converse`, comprobado el 2026-09-28 en
 * `eu-north-1`). Llevan el prefijo `eu.` porque son perfiles de inferencia entre
 * regiones de la integración clásica: ese prefijo y los ARN de perfil no existen
 * en el endpoint de Mensajes, que da 404 con ellos.
 */
const IDENTIFICADOR_BEDROCK_EU: Record<PapelModelo, string> = {
  opus5: 'eu.anthropic.claude-sonnet-4-6',
  sonnet5: 'eu.anthropic.claude-sonnet-4-6',
  haiku45: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
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
  if (plataforma === 'bedrock-eu') return IDENTIFICADOR_BEDROCK_EU[papel];
  return IDENTIFICADOR_DESNUDO_OBJETIVO[papel];
}

/**
 * `true` cuando el papel, en esa plataforma, lo sirve hoy un sustituto provisional
 * en vez del modelo objetivo del ADR-018 (por ejemplo, Sonnet 4.6 en Bedrock en
 * vez de Opus 5). Lo usa el adaptador para ajustar lo que el modelo provisional no
 * admite todavía (`anthropic.ts`: el esfuerzo `xhigh` y el suelo de esfuerzo alto
 * para `opus5`). `haiku45` no es provisional en ninguna plataforma: el
 * identificador con fecha de Bedrock es una excepción de nombrado, no una
 * sustitución de modelo.
 */
export function esProvisional(papel: PapelModelo, plataforma: PlataformaModelo): boolean {
  return plataforma === 'bedrock-eu' && PAPELES_CON_SUSTITUTO_PROVISIONAL_BEDROCK.has(papel);
}

/** El nombre canónico de un papel, tal como se registra en el contador (`modelo`). Es el objetivo del ADR-018, no la sustitución provisional. */
export function nombreCanonico(papel: PapelModelo): string {
  return IDENTIFICADOR_DESNUDO_OBJETIVO[papel];
}
