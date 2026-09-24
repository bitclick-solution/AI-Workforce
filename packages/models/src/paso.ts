/**
 * Un paso de modelo sobre las primitivas del AI SDK.
 *
 * Un paso: se llama una vez, se devuelve lo que el modelo dijo y se para. Las
 * herramientas se le ofrecen **sin** función que las ejecute, que es la primitiva
 * que hace que `generateText` devuelva las llamadas en vez de resolverlas él. Quien
 * las ejecuta es el bucle del agente, después de pasar por política, presupuesto,
 * guardias y auditoría.
 *
 * Es deliberado y es la frontera de arquitectura: «el bucle del agente es código
 * propio sobre el AI SDK». Si aquí se pusiera `stopWhen` con un contador de pasos y
 * herramientas con `execute`, el AI SDK haría el bucle y ninguno de los ganchos se
 * ejecutaría. El AI SDK aporta el formato de la conversación, el reintento del
 * transporte y la telemetría; las decisiones son nuestras.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { generateText, jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';

import { tokensParaElContador, type TokensParaElContador } from './uso.js';
import {
  metadatosDeTelemetria,
  trazasApagadas,
  type AtributosDeTraza,
  type PuertoDeTrazas,
} from './trazas.js';

/** Herramienta ofrecida al modelo: nombre, para qué sirve y qué argumentos toma. */
export interface HerramientaOfrecida {
  nombre: string;
  descripcion: string;
  /** Esquema JSON, tal como lo publicó el servidor MCP. No se reescribe. */
  esquemaEntrada: unknown;
}

/** Lo que el modelo pidió. Los argumentos van sin validar: los valida el gateway. */
export interface LlamadaPedida {
  id: string;
  herramienta: string;
  argumentos: Record<string, unknown>;
}

export interface PasoDeModelo {
  texto: string;
  llamadas: readonly LlamadaPedida[];
  tokens: TokensParaElContador;
  proveedor: string;
  modeloId: string;
  duracionMs: number;
  /** Motivo por el que el modelo paró, normalizado por el AI SDK. */
  motivoFin: string;
}

export interface PeticionDePaso {
  modelo: LanguageModelV4;
  /** Prompt de la versión de puesto. Entra tal cual, con marca de caché. */
  sistema: string;
  mensajes: readonly ModelMessage[];
  herramientas: readonly HerramientaOfrecida[];
  atributos: AtributosDeTraza;
  trazas?: PuertoDeTrazas | undefined;
  /** Nombre de la traza. Por defecto, el del paso del agente. */
  nombreTraza?: string | undefined;
  maxTokensSalida?: number | undefined;
  temperatura?: number | undefined;
}

/**
 * Convierte el catálogo del gateway en el conjunto de herramientas del AI SDK.
 *
 * Sin `execute`. Es la línea que sostiene la frontera: una herramienta con
 * `execute` la ejecutaría el AI SDK dentro de `generateText`, sin pasar por la
 * política ni por el libro de auditoría.
 */
export function herramientasParaElModelo(herramientas: readonly HerramientaOfrecida[]): ToolSet {
  const conjunto: ToolSet = {};
  for (const herramienta of herramientas) {
    conjunto[herramienta.nombre] = tool({
      description: herramienta.descripcion,
      inputSchema: jsonSchema(herramienta.esquemaEntrada as Parameters<typeof jsonSchema>[0]),
    });
  }
  return conjunto;
}

function argumentosDe(entrada: unknown): Record<string, unknown> {
  if (typeof entrada === 'object' && entrada !== null) return entrada as Record<string, unknown>;
  if (typeof entrada === 'string') {
    try {
      const analizado: unknown = JSON.parse(entrada);
      if (typeof analizado === 'object' && analizado !== null) {
        return analizado as Record<string, unknown>;
      }
    } catch {
      // Un modelo puede devolver argumentos que no son JSON. No es este módulo el
      // que decide qué hacer con eso: se pasan vacíos y el gateway rechaza.
    }
  }
  return {};
}

/**
 * Da un paso de modelo y devuelve lo que dijo, sus tokens y su traza.
 *
 * La caché del prompt se pide con `providerOptions`: en Anthropic marca el bloque
 * de sistema como reutilizable, y el prompt de una versión de puesto es exactamente
 * lo que conviene marcar, porque es inmutable y se repite en cada paso de cada
 * tarea de ese puesto. Un proveedor que no entienda la opción la ignora.
 */
export async function darPasoDeModelo(peticion: PeticionDePaso): Promise<PasoDeModelo> {
  const trazas = peticion.trazas ?? trazasApagadas;
  const herramientas = herramientasParaElModelo(peticion.herramientas);
  const metadatos = metadatosDeTelemetria(peticion.atributos);
  const comienzo = Date.now();

  const resultado = await generateText({
    model: peticion.modelo,
    system: peticion.sistema,
    messages: [...peticion.mensajes],
    tools: herramientas,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    ...(peticion.maxTokensSalida === undefined
      ? {}
      : { maxOutputTokens: peticion.maxTokensSalida }),
    ...(peticion.temperatura === undefined ? {} : { temperature: peticion.temperatura }),
    // Los cuatro identificadores viajan por el contexto de ejecución, que es por
    // donde el AI SDK 7 pasa los metadatos a la telemetría, y se declaran uno a uno
    // como incluidos: lo que no se declara no sale, y así ningún dato entra en una
    // traza por descuido.
    runtimeContext: metadatos,
    telemetry: {
      isEnabled: true,
      functionId: peticion.nombreTraza ?? 'agente.paso',
      includeRuntimeContext: Object.fromEntries(
        Object.keys(metadatos).map((clave) => [clave, true]),
      ),
    },
  });

  const duracionMs = Date.now() - comienzo;
  const tokens = tokensParaElContador(resultado.usage);
  const llamadas: LlamadaPedida[] = resultado.toolCalls.map((llamada) => ({
    id: llamada.toolCallId,
    herramienta: llamada.toolName,
    argumentos: argumentosDe((llamada as { input?: unknown }).input),
  }));

  trazas.registrar({
    ...peticion.atributos,
    nombre: peticion.nombreTraza ?? 'agente.paso',
    duracionMs,
    tokensEntrada: tokens.entrada,
    tokensSalida: tokens.salida,
    tokensEntradaCache: tokens.entradaCache,
    // El coste lo pone el contador con la tarifa del tenant; la traza guarda cero
    // hasta que alguien lo rellene, y no inventa un precio aquí.
    costeEuros: 0,
    herramientasOfrecidas: peticion.herramientas.length,
    herramientasPedidas: llamadas.map((llamada) => llamada.herramienta),
  });

  return {
    texto: resultado.text,
    llamadas,
    tokens,
    proveedor: peticion.atributos.proveedor,
    modeloId: peticion.atributos.modelo,
    duracionMs,
    motivoFin: resultado.finishReason,
  };
}
