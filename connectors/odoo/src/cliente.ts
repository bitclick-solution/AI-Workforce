/**
 * Cliente del MCP dinámico.
 *
 * El MCP dinámico (erpipe-org/mcp-odoo, MIT, Python) se consume como imagen de
 * contenedor aislada, igual que Factusol: no se reescribe ni se copia aquí. Este
 * módulo es la única puerta hacia él; las herramientas del conector no saben
 * por dónde viaja la llamada.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ErrorConector, motivoDeMensaje, recortarDetalle } from './errores.js';

export interface ClienteMcpDinamico {
  /** Llama a una herramienta del MCP dinámico y devuelve su carga ya en JSON. */
  llamar(herramienta: string, argumentos: Record<string, unknown>): Promise<unknown>;
  cerrar(): Promise<void>;
}

/** Herramientas del MCP dinámico que usa el conector. Ni una más. */
export const HERRAMIENTAS_DINAMICAS = {
  buscar: 'search_records',
  notaEnHistorial: 'chatter_post',
  prepararEscritura: 'preview_write',
  validarEscritura: 'validate_write',
  ejecutarEscritura: 'execute_approved_write',
} as const;

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

/** El MCP dinámico responde en texto JSON o en contenido estructurado; valen las dos. */
export function leerCarga(resultado: ResultadoHerramienta, herramienta: string): unknown {
  const texto = textoDe(resultado);
  if (resultado.isError === true) {
    // El motivo se decide sobre el texto entero; el mensaje solo lleva el recorte.
    throw new ErrorConector(
      motivoDeMensaje(texto),
      `El MCP dinámico rechazó «${herramienta}»: ${recortarDetalle(texto) || 'sin detalle'}`,
    );
  }
  if (resultado.structuredContent !== undefined) return resultado.structuredContent;
  if (texto === '') return {};
  try {
    return JSON.parse(texto);
  } catch {
    return { texto };
  }
}

export interface OpcionesClienteHttp {
  readonly extremo: string;
  readonly tiempoLimiteMs?: number;
}

/**
 * Cliente sobre el transporte HTTP «streamable» del MCP dinámico.
 *
 * Conecta la primera vez que se le pide algo y reutiliza la sesión. Las
 * credenciales de Odoo no viajan por aquí: las lleva la imagen en su propio
 * entorno, una por tenant (ver el README del conector).
 */
export function clienteHttp(opciones: OpcionesClienteHttp): ClienteMcpDinamico {
  const tiempoLimiteMs = opciones.tiempoLimiteMs ?? 60_000;
  let cliente: Client | undefined;
  let conexion: Promise<Client> | undefined;

  async function conectar(): Promise<Client> {
    if (conexion === undefined) {
      conexion = (async () => {
        const nuevo = new Client({ name: 'aiw-conector-odoo', version: '0.0.0' });
        // El SDK declara las propiedades opcionales de `Transport` sin `| undefined`,
        // que es justo lo que exige `exactOptionalPropertyTypes` del repositorio.
        const transporte = new StreamableHTTPClientTransport(new URL(opciones.extremo));
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
        { name: herramienta, arguments: argumentos },
        undefined,
        { timeout: tiempoLimiteMs },
      )) as ResultadoHerramienta;
      return leerCarga(resultado, herramienta);
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
  readonly carga?: unknown;
  /** Fallo inyectado: el conector lo traduce a uno de los cuatro motivos. */
  readonly error?: string;
}

export type Grabaciones = Record<string, readonly LlamadaGrabada[]>;

function casa(esperado: unknown, recibido: unknown): boolean {
  if (esperado === null || typeof esperado !== 'object') return esperado === recibido;
  if (Array.isArray(esperado)) {
    return (
      Array.isArray(recibido) &&
      esperado.length === recibido.length &&
      esperado.every((valor, indice) => casa(valor, recibido[indice]))
    );
  }
  if (typeof recibido !== 'object' || recibido === null) return false;
  const objeto = recibido as Record<string, unknown>;
  return Object.entries(esperado as Record<string, unknown>).every(([clave, valor]) =>
    casa(valor, objeto[clave]),
  );
}

/**
 * Cliente sobre respuestas grabadas.
 *
 * Es el que corre en la integración continua, que no alcanza Odoo. Las
 * grabaciones llevan datos inventados: ni un dato personal real.
 */
export function clienteGrabado(grabaciones: Grabaciones): ClienteMcpDinamico & {
  readonly llamadas: { herramienta: string; argumentos: Record<string, unknown> }[];
} {
  const llamadas: { herramienta: string; argumentos: Record<string, unknown> }[] = [];
  return {
    llamadas,
    async llamar(herramienta, argumentos) {
      llamadas.push({ herramienta, argumentos });
      const candidatas = grabaciones[herramienta] ?? [];
      const grabada = candidatas.find(
        (candidata) => candidata.argumentos === undefined || casa(candidata.argumentos, argumentos),
      );
      if (grabada === undefined) {
        throw new ErrorConector(
          'invalido',
          `No hay grabación para «${herramienta}» con esos argumentos. Graba la respuesta en src/grabaciones.`,
        );
      }
      if (grabada.error !== undefined) throw new Error(grabada.error);
      return grabada.carga ?? {};
    },
    async cerrar() {
      llamadas.length = 0;
    },
  };
}
