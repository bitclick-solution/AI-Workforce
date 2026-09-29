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

/**
 * Ubicaciones de Vertex AI que cumplen la residencia UE (ADR-017, ADR-023): la
 * multirregión `eu` (recomendada, la que ha habilitado Jesús — reparte tráfico
 * entre regiones de la Unión Europea sin salir de ella) o una región concreta
 * `europe-*` (por ejemplo `europe-west1`). Nunca `global` ni `us`: esas
 * ubicaciones no garantizan la residencia UE (`docs.claude.com/en/build-with-claude/claude-on-vertex-ai`,
 * comprobado el 2026-09-29).
 */
const REGION_VERTEX_UE_VALIDA = /^(eu|europe-[a-z0-9]+)$/;

/**
 * `true` cuando la región cumple la residencia UE. Exportada para probarla sin
 * construir el cliente real: `AnthropicVertex` intenta resolver credenciales de
 * Google (ADC) en cuanto se construye, incluso con una región válida y sin hacer
 * ninguna llamada — en un entorno sin ADC eso deja una promesa rechazada sin
 * capturar (mismo aviso que arriba, en `clientes.test.ts`), así que las pruebas
 * de esta función no pasan por `clienteVertexDesdeEntorno`.
 */
export function esRegionVertexUEValida(region: string): boolean {
  return REGION_VERTEX_UE_VALIDA.test(region);
}

function comprobarResidenciaVertexUE(region: string): void {
  if (!esRegionVertexUEValida(region)) {
    throw new Error(
      `AIW_VERTEX_REGION_UE="${region}" no es una ubicación de la UE de Vertex AI (ADR-017): usa la ` +
        'multirregión "eu" (recomendada) o una región concreta "europe-*" (por ejemplo "europe-west1"). ' +
        'El arranque rechaza "global", "us" o cualquier otra región fuera de la UE.',
    );
  }
}

/**
 * Cliente real de Vertex UE (ADR-017, ADR-023: proveedor principal). Necesita
 * `AIW_VERTEX_REGION_UE` y `AIW_VERTEX_PROJECT_ID`. Sin clave de API: el SDK de
 * Vertex se autentica siempre con `google-auth-library` (credenciales de
 * aplicación por defecto de Google o cuenta de servicio) — ver
 * `docs/runbooks/vertex-wif.md`.
 */
export function clienteVertexDesdeEntorno(entorno: Entorno = process.env): ClienteDeMensajes {
  const region = exigirVariable(
    entorno,
    'AIW_VERTEX_REGION_UE',
    'la ruta de Vertex necesita una región de la UE (ADR-017); no se infiere ninguna por defecto.',
  );
  comprobarResidenciaVertexUE(region);
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
