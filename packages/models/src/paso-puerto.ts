/**
 * Un paso de modelo sobre el puerto de Modelos v1: el camino de los proveedores
 * reales (Bedrock UE, Vertex UE).
 *
 * Hace lo mismo que `paso.ts` —un paso, se llama una vez y se devuelve lo que el
 * modelo dijo, sin ejecutar ninguna herramienta— pero sobre `PuertoDeModelo`, que
 * es la ruta de Anthropic (ADR-002, ADR-017). Devuelve lo mismo que `darPasoDeModelo`
 * más lo que el contador necesita: quién sirvió la respuesta, qué intentos fallaron
 * y, si el clasificador rechazó, la categoría.
 */
import type { ClasePaso } from '@aiw/domain';

import type { HerramientaOfrecida, LlamadaPedida } from './paso.js';
import type { MensajeDeModelo } from './puerto.js';
import type { IntentoFallido, PuertoEnrutado, Sirvio } from './respaldo.js';
import { trazasApagadas, type AtributosDeTraza, type PuertoDeTrazas } from './trazas.js';
import { tokensParaElContador, type TokensParaElContador } from './uso.js';

export interface PeticionDePasoConPuerto {
  puerto: PuertoEnrutado;
  clasePaso: ClasePaso;
  sistema: string;
  mensajes: readonly MensajeDeModelo[];
  herramientas: readonly HerramientaOfrecida[];
  atributos: Omit<AtributosDeTraza, 'proveedor' | 'modelo'>;
  trazas?: PuertoDeTrazas | undefined;
  nombreTraza?: string | undefined;
  maxTokensSalida?: number | undefined;
}

export interface PasoConPuerto {
  texto: string;
  llamadas: readonly LlamadaPedida[];
  tokens: TokensParaElContador;
  duracionMs: number;
  /** Motivo de parada, con el vocabulario del AI SDK: `stop`, `tool-calls`, `length`, `content-filter`. */
  motivoFin: string;
  sirvio: Sirvio;
  intentosFallidos: readonly IntentoFallido[];
  /** Contenido original del modelo para el turno siguiente. Opaco. */
  bloques?: readonly unknown[] | undefined;
  /** Presente cuando el clasificador rechazó y ningún respaldo lo sirvió: paso fallido no reintentable. */
  rechazo?: { categoria: string | null; explicacion: string | null } | undefined;
}

function motivoDelAiSdk(parada: string | undefined, hayLlamadas: boolean): string {
  if (hayLlamadas) return 'tool-calls';
  if (parada === 'max_tokens') return 'length';
  return 'stop';
}

export async function darPasoConPuerto(peticion: PeticionDePasoConPuerto): Promise<PasoConPuerto> {
  const trazas = peticion.trazas ?? trazasApagadas;
  const comienzo = Date.now();

  const { resultado, sirvio, intentosFallidos } = await peticion.puerto.completar({
    clasePaso: peticion.clasePaso,
    sistema: peticion.sistema,
    cacheSistema: true,
    mensajes: [...peticion.mensajes],
    herramientas: peticion.herramientas.map((herramienta) => ({
      nombre: herramienta.nombre,
      descripcion: herramienta.descripcion,
      esquemaJson: herramienta.esquemaEntrada as Record<string, unknown>,
    })),
    ...(peticion.maxTokensSalida === undefined ? {} : { maxTokens: peticion.maxTokensSalida }),
  });

  const duracionMs = Date.now() - comienzo;
  const tokens = tokensParaElContador({
    inputTokens: resultado.tokens.entrada + (resultado.tokens.entradaCache ?? 0),
    inputTokenDetails: {
      noCacheTokens: resultado.tokens.entrada,
      cacheReadTokens: resultado.tokens.entradaCache ?? 0,
    },
    outputTokens: resultado.tokens.salida,
  });

  const llamadas: LlamadaPedida[] =
    resultado.tipo === 'ok'
      ? (resultado.llamadasHerramientas ?? []).map((llamada) => ({
          id: llamada.id,
          herramienta: llamada.nombre,
          argumentos:
            typeof llamada.entrada === 'object' && llamada.entrada !== null
              ? (llamada.entrada as Record<string, unknown>)
              : {},
        }))
      : [];

  const atributos: AtributosDeTraza = {
    ...peticion.atributos,
    proveedor: sirvio.proveedor,
    modelo: sirvio.modeloId,
  };
  trazas.registrar({
    ...atributos,
    nombre: peticion.nombreTraza ?? 'agente.paso',
    duracionMs,
    tokensEntrada: tokens.entrada,
    tokensSalida: tokens.salida,
    tokensEntradaCache: tokens.entradaCache,
    // El coste lo pone el contador con la tarifa del tenant, no esta traza.
    costeEuros: 0,
    herramientasOfrecidas: peticion.herramientas.length,
    herramientasPedidas: llamadas.map((llamada) => llamada.herramienta),
  });

  if (resultado.tipo === 'rechazo') {
    return {
      texto: '',
      llamadas: [],
      tokens,
      duracionMs,
      motivoFin: 'content-filter',
      sirvio,
      intentosFallidos,
      rechazo: { categoria: resultado.categoria, explicacion: resultado.explicacion },
    };
  }

  return {
    texto: resultado.texto,
    llamadas,
    tokens,
    duracionMs,
    motivoFin: motivoDelAiSdk(resultado.motivoFin, llamadas.length > 0),
    sirvio,
    intentosFallidos,
    ...(resultado.bloques === undefined ? {} : { bloques: resultado.bloques }),
  };
}
