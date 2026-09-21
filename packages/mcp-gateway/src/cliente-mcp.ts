/**
 * Cliente MCP: envuelve el SDK oficial en la conexión que usa el gateway.
 *
 * El gateway no habla JSON-RPC ni sabe de transportes: recibe un transporte ya
 * construido —con la credencial dentro, si el conector la necesita— y lo convierte
 * en algo que sabe listar y llamar. Que el transporte lo construya quien registra
 * el conector es lo que hace que la credencial no tenga por qué pasar por ninguna
 * capa intermedia.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  clasificar,
  type ConexionMcp,
  type HerramientaDescubierta,
  type HerramientaMcp,
  type ResultadoHerramienta,
} from './herramientas.js';

/**
 * Transporte del SDK, tal como el SDK lo construye.
 *
 * El SDK declara sus manejadores y su identificador de sesión como propiedades
 * opcionales que sí pueden valer `undefined`, y con `exactOptionalPropertyTypes`
 * eso no encaja en su propia interfaz `Transport`. Es una incompatibilidad de la
 * librería con un ajuste estricto nuestro, y se puentea aquí, en una función con
 * nombre y en un solo sitio, en vez de relajar el ajuste para todo el repositorio o
 * repartir aserciones por cada fábrica de transporte.
 */
export type TransporteDelSdk = object;

function comoTransporte(transporte: TransporteDelSdk): Transport {
  return transporte as Transport;
}

/** Nombre y versión con los que la plataforma se presenta ante un servidor MCP. */
export const IDENTIDAD_CLIENTE = { name: 'aiw-mcp-gateway', version: '0.1.0' } as const;

function textoDe(resultado: Record<string, unknown>): string {
  const contenido = resultado['content'];
  if (!Array.isArray(contenido)) return '';
  return contenido
    .map((parte: unknown) => {
      if (typeof parte !== 'object' || parte === null) return '';
      const texto = (parte as { text?: unknown }).text;
      return typeof texto === 'string' ? texto : '';
    })
    .join('');
}

/**
 * Abre la conexión contra un servidor MCP y descubre sus herramientas al vuelo.
 *
 * El descubrimiento no se cachea en disco ni se escribe en el código: se pregunta.
 * `conector.herramientas_descubiertas` guarda la última respuesta para el panel,
 * pero la verdad es lo que el servidor conteste ahora.
 */
export async function conectarPorMcp(
  transporte: TransporteDelSdk,
  conector: string,
): Promise<ConexionMcp> {
  const cliente = new Client(IDENTIDAD_CLIENTE);
  await cliente.connect(comoTransporte(transporte));

  return {
    async listar(): Promise<HerramientaDescubierta[]> {
      const { tools } = await cliente.listTools();
      return (tools as HerramientaMcp[]).map((herramienta) => clasificar(herramienta, conector));
    },

    async llamar(nombre, argumentos): Promise<ResultadoHerramienta> {
      const resultado = (await cliente.callTool({
        name: nombre,
        arguments: argumentos,
      })) as Record<string, unknown>;
      const texto = textoDe(resultado);
      const estructurado = resultado['structuredContent'];
      return {
        texto,
        esError: resultado['isError'] === true,
        ...(estructurado === undefined ? {} : { estructurado }),
      };
    },

    async cerrar(): Promise<void> {
      await cliente.close();
    },
  };
}
