/**
 * Construcción de los clientes reales y del cliente de pruebas.
 *
 * Las credenciales nunca se leen aquí como literales: llegan por variables de
 * entorno, y si faltan, la función falla con el nombre exacto de lo que falta en
 * vez de construir un cliente que fallaría más tarde con un error de red.
 *
 * Bedrock tiene dos caminos posibles, los dos en el mismo `@anthropic-ai/bedrock-sdk`
 * (comprobado el 2026-09-28, ver `docs/runbooks/modelos-funciones-ausentes.md`):
 * el endpoint de Mensajes (`AnthropicBedrockMantle`, `bedrock-mantle`) y la
 * integración clásica (`AnthropicBedrock`, `bedrock-runtime`, `InvokeModel`). Hoy la
 * cuenta de AWS no tiene acceso a ningún modelo de Anthropic por el endpoint de
 * Mensajes en las regiones de la UE (403 «not available for this account» en
 * `eu-north-1`/`eu-west-1`, sin ningún modelo de Anthropic en `eu-central-1`), así
 * que `clienteBedrockDesdeEntorno` construye el cliente clásico como vía
 * provisional. `clienteBedrockMantleDesdeEntorno` se queda lista para cuando AWS
 * conceda acceso: volver es cambiar qué función usa el adaptador y la tabla de
 * `identificadores.ts`, sin promoción de versión de puesto.
 */
import { AnthropicBedrock, AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';

import type { ClienteDeMensajes } from './cliente-mensajes.js';

export type Entorno = Record<string, string | undefined>;

function exigirVariable(entorno: Entorno, clave: string, porQue: string): string {
  const valor = entorno[clave];
  if (valor === undefined || valor.trim() === '') {
    throw new Error(`Falta ${clave}: ${porQue}`);
  }
  return valor;
}

/**
 * Cliente real de Bedrock UE (ADR-017), vía la integración clásica (`bedrock-runtime`,
 * `InvokeModel`) con perfiles de inferencia UE — vía provisional mientras la cuenta
 * no tenga acceso al endpoint de Mensajes (ver el comentario de arriba). Necesita
 * `AIW_BEDROCK_REGION_UE`.
 */
export function clienteBedrockDesdeEntorno(entorno: Entorno = process.env): ClienteDeMensajes {
  const region = exigirVariable(
    entorno,
    'AIW_BEDROCK_REGION_UE',
    'la ruta de Bedrock necesita una región de la UE (ADR-017); no se infiere ninguna por defecto.',
  );
  return new AnthropicBedrock({ awsRegion: region });
}

/**
 * Cliente real de Bedrock UE por el endpoint de Mensajes (`bedrock-mantle`,
 * `CreateInference`). No lo usa hoy ningún adaptador: la cuenta no tiene acceso a
 * ningún modelo de Anthropic por este camino en las regiones de la UE contratadas
 * (comprobado el 2026-09-28). Se deja lista para cuando AWS conceda acceso a Sonnet 5
 * y Opus 5 — ver «Cómo volver al endpoint de Mensajes» en
 * `docs/runbooks/modelos-funciones-ausentes.md`. Necesita `AIW_BEDROCK_REGION_UE`.
 */
export function clienteBedrockMantleDesdeEntorno(
  entorno: Entorno = process.env,
): ClienteDeMensajes {
  const region = exigirVariable(
    entorno,
    'AIW_BEDROCK_REGION_UE',
    'la ruta de Bedrock necesita una región de la UE (ADR-017); no se infiere ninguna por defecto.',
  );
  return new AnthropicBedrockMantle({ awsRegion: region });
}

/** Cliente real de Vertex UE (ADR-017). Necesita `AIW_VERTEX_REGION_UE` y `AIW_VERTEX_PROJECT_ID`. */
export function clienteVertexDesdeEntorno(entorno: Entorno = process.env): ClienteDeMensajes {
  const region = exigirVariable(
    entorno,
    'AIW_VERTEX_REGION_UE',
    'la ruta de Vertex necesita una región de la UE (ADR-017); no se infiere ninguna por defecto.',
  );
  const proyecto = exigirVariable(
    entorno,
    'AIW_VERTEX_PROJECT_ID',
    'la ruta de Vertex necesita el proyecto de GCP donde está activado el modelo.',
  );
  return new AnthropicVertex({ region, projectId: proyecto });
}

/**
 * Cliente de primera parte. Solo para usos internos sin datos de clientes
 * (ADR-017): Revisor en la integración continua, fábrica de agentes, evals con
 * datos sintéticos. Nunca para una tarea de un tenant.
 */
export function clientePrimeraParteDesdeEntorno(entorno: Entorno = process.env): ClienteDeMensajes {
  const apiKey = exigirVariable(
    entorno,
    'ANTHROPIC_API_KEY',
    'la primera parte es solo para usos internos sin datos de clientes (ADR-017).',
  );
  return new Anthropic({ apiKey });
}

/**
 * Cliente contra un servidor que reproduce la forma de la API de Mensajes, sin
 * credenciales reales. Es lo único que prueba este paquete hasta que existan
 * credenciales de Bedrock o de Vertex en la UE.
 */
export function clienteSimulado(baseURL: string): ClienteDeMensajes {
  return new Anthropic({ apiKey: 'clave-de-prueba-sin-valor-real', baseURL });
}
