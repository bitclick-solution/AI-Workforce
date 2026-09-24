/**
 * Del uso que devuelve el AI SDK a los tokens que cobra el contador.
 *
 * Aquí no se calcula ningún precio. El precio lo pone `@aiw/ledger` con la tarifa
 * vigente del tenant, porque el coste se congela junto a la tarifa que lo produjo y
 * eso solo lo puede hacer quien escribe la fila. Este módulo traduce, y traducir es
 * todo lo que hace.
 *
 * Traduce dos formas, no una, y no por gusto: la especificación del proveedor
 * anida el desglose dentro de `inputTokens`, y el resultado de `generateText` lo
 * saca a `inputTokenDetails`. Si el bucle tuviera que saber cuál de las dos le
 * llegó, la traducción acabaría copiada en cada sitio que mira un uso.
 *
 * Los `undefined` se tratan como cero. Un proveedor que no informa de los tokens de
 * caché no está diciendo que sean muchos: está diciendo que no lo sabe, y cobrar
 * por lo que nadie midió sería inventarse la factura.
 */

/** Tokens en la forma que espera `registrarUsoDeModelo` de `@aiw/ledger`. */
export interface TokensParaElContador {
  entrada: number;
  salida: number;
  entradaCache: number;
}

interface Desglose {
  total: number | undefined;
  noCache: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
}

/** Uso tal como lo devuelve un modelo que implementa la especificación del proveedor. */
export interface UsoDelProveedor {
  inputTokens?:
    | {
        total?: number | undefined;
        noCache?: number | undefined;
        cacheRead?: number | undefined;
        cacheWrite?: number | undefined;
      }
    | undefined;
  outputTokens?: { total?: number | undefined } | undefined;
}

/** Uso tal como lo devuelve `generateText`, con el desglose en otra propiedad. */
export interface UsoDelResultado {
  inputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        noCacheTokens?: number | undefined;
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
  outputTokens?: number | undefined;
}

export type UsoDeModelo = UsoDelProveedor | UsoDelResultado;

function entero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.round(valor) : 0;
}

/** Normaliza las dos formas en una sola: entrada con desglose y salida total. */
function normalizar(uso: UsoDeModelo | undefined): { entrada: Desglose; salida: number } {
  const entradaCruda = (uso as UsoDelProveedor | undefined)?.inputTokens;

  if (typeof entradaCruda === 'object' && entradaCruda !== null) {
    return {
      entrada: {
        total: entradaCruda.total,
        noCache: entradaCruda.noCache,
        cacheRead: entradaCruda.cacheRead,
        cacheWrite: entradaCruda.cacheWrite,
      },
      salida: entero((uso as UsoDelProveedor).outputTokens?.total),
    };
  }

  const resultado = uso as UsoDelResultado | undefined;
  const detalles = resultado?.inputTokenDetails;
  return {
    entrada: {
      total: resultado?.inputTokens,
      noCache: detalles?.noCacheTokens,
      cacheRead: detalles?.cacheReadTokens,
      cacheWrite: detalles?.cacheWriteTokens,
    },
    salida: entero(resultado?.outputTokens),
  };
}

/**
 * Traduce el uso.
 *
 * Los tokens de caché leída se tarifan aparte y más baratos, así que se restan de
 * la entrada: si no, se cobrarían dos veces. Se usa el desglose del proveedor
 * cuando lo da, y la resta solo cuando no lo da, porque su cuenta manda sobre la
 * nuestra. Escribir en la caché se factura como entrada normal: lo que sale barato
 * es leerla, no llenarla.
 */
export function tokensParaElContador(uso: UsoDeModelo | undefined): TokensParaElContador {
  const { entrada, salida } = normalizar(uso);

  const total = entero(entrada.total);
  const cacheLeida = entero(entrada.cacheRead);
  const cacheEscrita = entero(entrada.cacheWrite);
  const facturable =
    entrada.noCache === undefined ? Math.max(0, total - cacheLeida) : entero(entrada.noCache);

  return {
    entrada: facturable + cacheEscrita,
    salida,
    entradaCache: cacheLeida,
  };
}
