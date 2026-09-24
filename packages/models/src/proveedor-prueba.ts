/**
 * Proveedor de prueba determinista: un modelo del AI SDK que no llama a nadie.
 *
 * Implementa `LanguageModelV4`, la misma interfaz que implementa el proveedor de
 * Anthropic o el de cualquier otro. Eso importa: el bucle del agente, el cálculo
 * de coste y las trazas corren por el mismo camino en la integración continua que
 * en producción, y lo único que cambia es quién contesta al final.
 *
 * Contesta un guion. El guion recibe la conversación tal como la ve el modelo y
 * devuelve texto o llamadas a herramienta; los tokens los declara el propio guion,
 * así que el coste que se calcula en la CI es reproducible hasta el céntimo y vale
 * para probar la tabla de precios sin gastar un euro.
 *
 * No hay red, no hay clave, no hay reloj: dos ejecuciones con la misma
 * conversación dan el mismo resultado. Si un día falla, falla siempre.
 */
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  LanguageModelV4GenerateResult,
  LanguageModelV4Prompt,
} from '@ai-sdk/provider';

export const PROVEEDOR_PRUEBA = 'prueba';
export const MODELO_PRUEBA = 'deterministico';

/** Lo que el guion ve: la conversación y las herramientas que se le han ofrecido. */
export interface ContextoDeGuion {
  prompt: LanguageModelV4Prompt;
  /** Nombres de las herramientas del catálogo, en el orden en que se ofrecieron. */
  herramientas: readonly string[];
  /** Número de llamada al modelo dentro de esta conversación, empezando en 1. */
  turno: number;
}

/** Una llamada a herramienta que el guion quiere que el bucle ejecute. */
export interface LlamadaDeGuion {
  herramienta: string;
  argumentos: Record<string, unknown>;
}

export interface RespuestaDeGuion {
  /** Texto de la respuesta. Vacío cuando solo hay llamadas a herramienta. */
  texto?: string | undefined;
  llamadas?: readonly LlamadaDeGuion[] | undefined;
  /** Tokens que declara este turno. Sin valor, los de `tokensPorLlamada`. */
  tokens?: { entrada: number; salida: number; entradaCache?: number } | undefined;
}

export type Guion = (contexto: ContextoDeGuion) => RespuestaDeGuion;

export interface OpcionesProveedorDePrueba {
  guion: Guion;
  /** Tokens por defecto de cada turno. Fijos para que el coste sea reproducible. */
  tokensPorLlamada?: { entrada: number; salida: number; entradaCache?: number } | undefined;
  modeloId?: string | undefined;
}

/** Turnos ya dados por conversación. La clave es la conversación serializada. */
function contarTurno(vistos: Map<string, number>, prompt: LanguageModelV4Prompt): number {
  const llave = JSON.stringify(prompt);
  const turno = (vistos.get(llave) ?? 0) + 1;
  vistos.set(llave, turno);
  return turno;
}

/**
 * Nombres de las herramientas ofrecidas en esta llamada.
 *
 * Se leen de las opciones del AI SDK y no de ningún registro propio: lo que el
 * guion ve es exactamente lo que vería un modelo de verdad, ni una más.
 */
function herramientasOfrecidas(opciones: LanguageModelV4CallOptions): string[] {
  const herramientas = opciones.tools ?? [];
  return herramientas
    .map((herramienta) => (herramienta as { name?: unknown }).name)
    .filter((nombre): nombre is string => typeof nombre === 'string');
}

export function crearProveedorDePrueba(opciones: OpcionesProveedorDePrueba): LanguageModelV4 {
  const porDefecto = opciones.tokensPorLlamada ?? { entrada: 800, salida: 120 };
  const turnos = new Map<string, number>();

  return {
    specificationVersion: 'v4',
    provider: PROVEEDOR_PRUEBA,
    modelId: opciones.modeloId ?? MODELO_PRUEBA,
    supportedUrls: {},

    doGenerate(llamada: LanguageModelV4CallOptions): Promise<LanguageModelV4GenerateResult> {
      const turno = contarTurno(turnos, llamada.prompt);
      const respuesta = opciones.guion({
        prompt: llamada.prompt,
        herramientas: herramientasOfrecidas(llamada),
        turno,
      });

      const contenido: LanguageModelV4Content[] = [];
      if (respuesta.texto !== undefined && respuesta.texto !== '') {
        contenido.push({ type: 'text', text: respuesta.texto });
      }
      for (const [indice, llamadaDeGuion] of (respuesta.llamadas ?? []).entries()) {
        contenido.push({
          type: 'tool-call',
          // Determinista a propósito: el identificador no lleva azar ni reloj, así
          // que la misma conversación produce la misma traza byte a byte.
          toolCallId: `prueba-${turno}-${indice + 1}`,
          toolName: llamadaDeGuion.herramienta,
          input: JSON.stringify(llamadaDeGuion.argumentos),
        });
      }

      const tokens = respuesta.tokens ?? porDefecto;
      const hayLlamadas = (respuesta.llamadas ?? []).length > 0;

      return Promise.resolve({
        content: contenido,
        finishReason: {
          unified: hayLlamadas ? 'tool-calls' : 'stop',
          raw: hayLlamadas ? 'tool_use' : 'end_turn',
        },
        usage: {
          inputTokens: {
            total: tokens.entrada,
            noCache: tokens.entrada - (tokens.entradaCache ?? 0),
            cacheRead: tokens.entradaCache ?? 0,
            cacheWrite: 0,
          },
          outputTokens: { total: tokens.salida, text: tokens.salida, reasoning: 0 },
        },
        warnings: [],
      });
    },

    doStream(): never {
      // El bucle no transmite: pide un paso completo, decide y vuelve a pedir. Un
      // proveedor de prueba que finja transmitir escondería que no hace falta.
      throw new Error('El proveedor de prueba no transmite: el bucle llama paso a paso.');
    },
  };
}
