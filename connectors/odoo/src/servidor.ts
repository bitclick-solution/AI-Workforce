/**
 * Servidor MCP del conector.
 *
 * Anuncia exactamente dos herramientas. Usa la interfaz de bajo nivel del SDK
 * a propósito: así un fallo sale como error MCP con `code`, `message` en
 * español y `datos.motivo`, y no como texto dentro de un resultado correcto.
 *
 * Transporte: stdio, que es como lo lanza el gateway. Con
 * `ODOO_CONECTOR_HTTP=1` levanta además el transporte HTTP «streamable».
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { clienteHttp, type ClienteMcpDinamico } from './cliente.js';
import { leerConfiguracion, redactar, registrar, type ConfiguracionOdoo } from './entorno.js';
import { ErrorConector, traducirError } from './errores.js';
import { ESQUEMA_ENTRADA_LISTAR, ESQUEMA_ENTRADA_NOTA } from './esquema-json.js';
import { NOMBRES, crearHerramientas, type Herramientas } from './herramientas.js';
import { esProcesoPrincipal } from './proceso.js';

export const NOMBRE_SERVIDOR = 'aiw-conector-odoo';
export const VERSION_SERVIDOR = '0.0.0';

export const DESCRIPCIONES = {
  [NOMBRES.listar]:
    'Devuelve las facturas de cliente vencidas y sin cobrar del ERP, de más a menos días vencida. Solo lectura.',
  [NOMBRES.nota]:
    'Anota una nota de seguimiento o una actividad con fecha límite en una factura del ERP. Escritura.',
} as const;

export const CATALOGO = [
  {
    name: NOMBRES.listar,
    description: DESCRIPCIONES[NOMBRES.listar],
    inputSchema: ESQUEMA_ENTRADA_LISTAR,
  },
  {
    name: NOMBRES.nota,
    description: DESCRIPCIONES[NOMBRES.nota],
    inputSchema: ESQUEMA_ENTRADA_NOTA,
  },
] as const;

export interface OpcionesServidor {
  readonly herramientas: Herramientas;
  /** Valores que se tapan en todo mensaje que sale del proceso. */
  readonly secretos?: readonly (string | undefined)[];
}

/** Construye el servidor MCP sobre unas herramientas ya montadas. */
export function crearServidor(opciones: OpcionesServidor): Server {
  const secretos = opciones.secretos ?? [];
  const servidor = new Server(
    { name: NOMBRE_SERVIDOR, version: VERSION_SERVIDOR },
    { capabilities: { tools: {} } },
  );

  servidor.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...CATALOGO] }));

  servidor.setRequestHandler(CallToolRequestSchema, async (peticion) => {
    const { name, arguments: argumentos } = peticion.params;
    try {
      const salida =
        name === NOMBRES.listar
          ? await opciones.herramientas.listarFacturasVencidas(argumentos ?? {})
          : name === NOMBRES.nota
            ? await opciones.herramientas.crearNotaSeguimiento(argumentos)
            : (() => {
                throw new ErrorConector('no_encontrada', `El conector de Odoo no sirve «${name}».`);
              })();
      return {
        content: [{ type: 'text', text: JSON.stringify(salida) }],
        structuredContent: salida,
      };
    } catch (error) {
      const fallo = traducirError(error, `Fallo en «${name}»`);
      throw new McpError(fallo.codigo, redactar(fallo.message, secretos), fallo.datos);
    }
  });

  return servidor;
}

/** Monta el conector completo: configuración, cliente del MCP dinámico y servidor. */
export function montarConector(configuracion: ConfiguracionOdoo): {
  servidor: Server;
  cliente: ClienteMcpDinamico;
} {
  const cliente = clienteHttp({ extremo: configuracion.extremoMcp });
  const servidor = crearServidor({
    herramientas: crearHerramientas({ cliente }),
    secretos: [configuracion.claveApi],
  });
  return { servidor, cliente };
}

const PUERTO_HTTP_POR_DEFECTO = 4020;

async function servirPorHttp(servidor: Server, puerto: number): Promise<void> {
  // Sin generador de sesión: una sesión por proceso, como el transporte por stdio.
  // Los `as` tapan que el SDK declara sus opcionales sin `| undefined`, que es lo
  // que pide `exactOptionalPropertyTypes` en este repositorio.
  const transporte = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
  await servidor.connect(transporte as unknown as Transport);
  createServer((peticion: IncomingMessage, respuesta: ServerResponse) => {
    void transporte.handleRequest(peticion, respuesta);
  }).listen(puerto);
  registrar(`Escuchando MCP por HTTP en el puerto ${String(puerto)}.`);
}

/**
 * Arranque del proceso.
 *
 * Detrás de bandera de funcionalidad hasta la demo: sin `AIW_CONECTOR_ODOO=1`
 * el proceso no abre transporte ni toca el ERP, y termina diciendo por qué.
 */
export async function principal(entorno = process.env): Promise<void> {
  if (entorno['AIW_CONECTOR_ODOO'] !== '1') {
    registrar('Bandera AIW_CONECTOR_ODOO apagada: el conector no arranca.');
    return;
  }
  const configuracion = leerConfiguracion(entorno);
  const { servidor } = montarConector(configuracion);
  if (entorno['ODOO_CONECTOR_HTTP'] === '1') {
    await servirPorHttp(
      servidor,
      Number(entorno['ODOO_CONECTOR_PUERTO'] ?? PUERTO_HTTP_POR_DEFECTO),
    );
    return;
  }
  await servidor.connect(new StdioServerTransport() as unknown as Transport);
  registrar('Escuchando MCP por stdio.');
}

if (esProcesoPrincipal(import.meta.url)) {
  principal().catch((error: unknown) => {
    const fallo = traducirError(error, 'El conector de Odoo no arrancó');
    registrar(fallo.message, [process.env['ODOO_CLAVE_API']]);
    process.exitCode = 1;
  });
}
