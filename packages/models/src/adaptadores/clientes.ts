/**
 * Construcción de los clientes reales y del cliente de pruebas.
 *
 * Las credenciales nunca se leen aquí como literales: llegan por variables de
 * entorno, y si faltan, la función falla con el nombre exacto de lo que falta en
 * vez de construir un cliente que fallaría más tarde con un error de red. Ahora
 * mismo no hay credenciales de Bedrock ni de Vertex en la UE (ver el runbook de
 * `docs/runbooks/modelos-funciones-ausentes.md`): estas funciones están listas para
 * cuando lleguen, y hasta entonces el adaptador se prueba con `clienteSimulado`.
 */
import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
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

/** Cliente real de Bedrock UE (ADR-017). Necesita `AIW_BEDROCK_REGION_UE`. */
export function clienteBedrockDesdeEntorno(entorno: Entorno = process.env): ClienteDeMensajes {
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
