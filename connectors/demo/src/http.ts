/**
 * El conector de demostración por HTTP transmisible.
 *
 * Tres transportes para el mismo servidor, y cada uno sirve para algo distinto:
 * en memoria para las pruebas y para el trabajador que monta el conector dentro de
 * su proceso; entrada estándar para un conector que se lanza como proceso hijo con
 * la credencial en el entorno; y este, HTTP, para un conector que ya está corriendo
 * en otro sitio, que es como va a estar el de Odoo.
 *
 * El gateway registra cualquiera de los tres sin enterarse: su registro guarda
 * fábricas de transporte, no transportes, y lo único que le pide a una fábrica es
 * que devuelva algo que sepa listar y llamar.
 *
 * Con sesión. El modo sin estado del SDK obliga a montar un servidor nuevo por
 * peticion, y entonces las notas escritas no sobrevivirían de una llamada a la
 * siguiente, que es justo el efecto que la demostración tiene que enseñar. Con
 * sesión hay un servidor y un transporte por cliente, que es también como va a
 * estar el conector de Odoo.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

/** Mismo puente que en el gateway: el SDK no encaja en su propia interfaz con
 * `exactOptionalPropertyTypes`, y la aserción vive en una función con nombre. */
function comoTransporte(transporte: object): Transport {
  return transporte as Transport;
}

import { crearServidorDemo, type OpcionesServidorDemo, type ServidorDemo } from './servidor.js';

/** Ruta en la que escucha el servidor. La misma que usa el cliente por defecto. */
export const RUTA_MCP = '/mcp';

export interface OpcionesHttp extends OpcionesServidorDemo {
  /** Puerto. Cero deja que el sistema elija uno libre, que es lo que hacen las pruebas. */
  puerto?: number | undefined;
  direccion?: string | undefined;
}

export interface ServidorHttp {
  demo: ServidorDemo;
  http: Server;
  /** URL completa, con el puerto de verdad cuando se pidió el cero. */
  url: string;
  cerrar: () => Promise<void>;
}

export async function servirDemoPorHttp(opciones: OpcionesHttp): Promise<ServidorHttp> {
  const demo = crearServidorDemo(opciones);
  const transporte = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await demo.servidor.connect(comoTransporte(transporte));

  const direccion = opciones.direccion ?? '127.0.0.1';
  const aplicacion = createMcpExpressApp({ host: direccion });
  // Express no trae sus tipos y no se añaden por una ruta: el SDK ya declara qué
  // forma tiene lo que `handleRequest` espera, y es lo único que hace falta aquí.
  type PeticionMcp = Parameters<StreamableHTTPServerTransport['handleRequest']>[0] & {
    body?: unknown;
  };
  type RespuestaMcp = Parameters<StreamableHTTPServerTransport['handleRequest']>[1];

  aplicacion.all(RUTA_MCP, (peticion: PeticionMcp, respuesta: RespuestaMcp) => {
    void transporte.handleRequest(peticion, respuesta, peticion.body);
  });

  const puerto = opciones.puerto ?? 0;
  const http: Server = await new Promise((listo) => {
    const escuchando = aplicacion.listen(puerto, direccion, () => listo(escuchando));
  });

  const escuchando = http.address();
  const puertoReal = typeof escuchando === 'object' && escuchando ? escuchando.port : puerto;

  return {
    demo,
    http,
    url: `http://${direccion}:${puertoReal}${RUTA_MCP}`,
    cerrar: async () => {
      await demo.servidor.close();
      await new Promise<void>((listo) => http.close(() => listo()));
    },
  };
}
