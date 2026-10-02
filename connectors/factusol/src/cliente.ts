/**
 * Cliente de Factusol MCP.
 *
 * Factusol MCP (Python, producto propio) se consume como imagen aislada: no se
 * reescribe ni se copia aquí. Habla SSE, no HTTP «streamable», y se autentica con
 * un JWT en `Authorization: Bearer`. Este módulo es la única puerta hacia él.
 * Añade `tenant_id` a cada llamada; ninguna herramienta del conector lo recibe.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ErrorConector, motivoDeMensaje, recortarDetalle } from './errores.js';

/** Respuesta de una herramienta: el texto Markdown y, si lo hay, el JSON estructurado. */
export interface RespuestaFactusol {
  readonly texto: string;
  /** Solo en herramientas que devuelven JSON (los borradores). Ausente en las de Markdown. */
  readonly estructurado?: unknown;
}

export interface ClienteFactusol {
  llamar(herramienta: string, argumentos: Record<string, unknown>): Promise<RespuestaFactusol>;
  cerrar(): Promise<void>;
}

/** Herramientas de Factusol MCP que usa el conector. Ni una más. */
export const HERRAMIENTAS_FACTUSOL = {
  listarFacturas: 'list_facturas_emitidas',
  factura: 'get_factura',
  formasDePago: 'get_formas_de_pago',
  cliente: 'get_cliente',
  borradorCliente: 'draft_modificar_cliente',
  cancelarBorrador: 'cancelar_borrador',
  estadoBorrador: 'get_estado_borrador',
} as const;

// `confirmar_operacion` no está en la lista a propósito: el adaptador nunca lo llama.

interface ContenidoTexto {
  readonly type: string;
  readonly text?: string;
}

interface ResultadoHerramienta {
  readonly content?: readonly ContenidoTexto[];
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

function textoDe(resultado: ResultadoHerramienta): string {
  return (resultado.content ?? [])
    .filter((parte) => parte.type === 'text' && typeof parte.text === 'string')
    .map((parte) => parte.text)
    .join('\n');
}

/**
 * `structuredContent` de una herramienta de Markdown es `{ result: <el mismo texto> }`
 * y no aporta nada. Solo cuenta como JSON de datos lo que no es esa envolvente.
 */
function estructuradoUtil(resultado: ResultadoHerramienta, texto: string): unknown {
  const estructurado = resultado.structuredContent;
  if (typeof estructurado === 'object' && estructurado !== null && !Array.isArray(estructurado)) {
    const claves = Object.keys(estructurado);
    const soloResult = claves.length === 1 && claves[0] === 'result';
    if (!soloResult) return estructurado;
  }
  const limpio = texto.trim();
  if (limpio.startsWith('{')) {
    try {
      return JSON.parse(limpio) as unknown;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function leerRespuesta(
  resultado: ResultadoHerramienta,
  herramienta: string,
): RespuestaFactusol {
  const texto = textoDe(resultado);
  if (resultado.isError === true) {
    throw new ErrorConector(
      motivoDeMensaje(texto),
      `Factusol MCP rechazó «${herramienta}»: ${recortarDetalle(texto) || 'sin detalle'}`,
    );
  }
  const estructurado = estructuradoUtil(resultado, texto);
  return estructurado === undefined ? { texto } : { texto, estructurado };
}

export interface OpcionesClienteSse {
  readonly extremo: string;
  readonly token: string;
  readonly tenantId: string;
  readonly tiempoLimiteMs?: number;
}

/** Cliente sobre SSE. Conecta la primera vez que se le pide algo y reutiliza la sesión. */
export function clienteSse(opciones: OpcionesClienteSse): ClienteFactusol {
  const tiempoLimiteMs = opciones.tiempoLimiteMs ?? 60_000;
  const cabeceras = { Authorization: `Bearer ${opciones.token}` };
  let cliente: Client | undefined;
  let conexion: Promise<Client> | undefined;

  async function conectar(): Promise<Client> {
    if (conexion === undefined) {
      conexion = (async () => {
        const nuevo = new Client({ name: 'aiw-conector-factusol', version: '0.0.0' });
        // El flujo `GET /sse` también lleva el JWT: `EventSource` no deja poner cabeceras
        // salvo con un `fetch` propio.
        const transporte = new SSEClientTransport(new URL(opciones.extremo), {
          requestInit: { headers: cabeceras },
          eventSourceInit: {
            fetch: (url: string | URL, init?: RequestInit) =>
              fetch(url, {
                ...init,
                headers: { ...(init?.headers as Record<string, string> | undefined), ...cabeceras },
              }),
          },
        } as unknown as ConstructorParameters<typeof SSEClientTransport>[1]);
        await nuevo.connect(transporte as unknown as Transport);
        cliente = nuevo;
        return nuevo;
      })().catch((error: unknown) => {
        conexion = undefined;
        throw error;
      });
    }
    return conexion;
  }

  return {
    async llamar(herramienta, argumentos) {
      const conectado = await conectar();
      const resultado = (await conectado.callTool(
        { name: herramienta, arguments: { tenant_id: opciones.tenantId, ...argumentos } },
        undefined,
        { timeout: tiempoLimiteMs },
      )) as ResultadoHerramienta;
      return leerRespuesta(resultado, herramienta);
    },
    async cerrar() {
      await cliente?.close();
      cliente = undefined;
      conexion = undefined;
    },
  };
}

export interface LlamadaGrabada {
  /** Subconjunto de argumentos que debe traer la llamada para casar con esta grabación. */
  readonly argumentos?: Record<string, unknown>;
  readonly texto?: string;
  readonly estructurado?: unknown;
  /** Fallo inyectado: el conector lo traduce a uno de los cuatro motivos. */
  readonly error?: string;
}

export type Grabaciones = Record<string, readonly LlamadaGrabada[]>;

function casa(esperado: unknown, recibido: unknown): boolean {
  if (esperado === null || typeof esperado !== 'object') return esperado === recibido;
  if (typeof recibido !== 'object' || recibido === null) return false;
  const objeto = recibido as Record<string, unknown>;
  return Object.entries(esperado as Record<string, unknown>).every(([clave, valor]) =>
    casa(valor, objeto[clave]),
  );
}

/**
 * Cliente sobre respuestas grabadas: el que corre en la integración continua, que
 * no alcanza Factusol. Las grabaciones llevan datos inventados con la forma exacta
 * del informe del Probador.
 */
export function clienteGrabado(grabaciones: Grabaciones): ClienteFactusol & {
  readonly llamadas: { herramienta: string; argumentos: Record<string, unknown> }[];
} {
  const llamadas: { herramienta: string; argumentos: Record<string, unknown> }[] = [];
  return {
    llamadas,
    async llamar(herramienta, argumentos) {
      llamadas.push({ herramienta, argumentos });
      const grabada = (grabaciones[herramienta] ?? []).find(
        (candidata) => candidata.argumentos === undefined || casa(candidata.argumentos, argumentos),
      );
      if (grabada === undefined) {
        throw new ErrorConector(
          'invalido',
          `No hay grabación para «${herramienta}» con esos argumentos. Graba la respuesta en src/grabaciones.`,
        );
      }
      if (grabada.error !== undefined) throw new Error(grabada.error);
      return grabada.estructurado === undefined
        ? { texto: grabada.texto ?? '' }
        : { texto: grabada.texto ?? '', estructurado: grabada.estructurado };
    },
    async cerrar() {
      llamadas.length = 0;
    },
  };
}
