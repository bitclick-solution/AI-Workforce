/**
 * Monta el conector de demostración en memoria y devuelve el transporte.
 *
 * Es MCP de verdad: el mismo SDK, el mismo JSON-RPC, las dos puntas de un par de
 * transportes enlazados. Lo que no hay es proceso ni puerto, así que una prueba de
 * integración del gateway corre en milisegundos y la integración continua no
 * necesita levantar nada.
 *
 * Devuelve el transporte y no una conexión ya envuelta porque envolver transportes
 * es trabajo del gateway: este paquete no conoce `@aiw/mcp-gateway`, y esa
 * dirección de la dependencia es la que evita que un conector pueda hablar con la
 * plataforma por cualquier otro camino que no sea MCP.
 */
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { crearServidorDemo, type OpcionesServidorDemo, type ServidorDemo } from './servidor.js';

export interface DemoEnMemoria {
  /** El servidor montado. Sirve para mirar las notas escritas y las llamadas. */
  demo: ServidorDemo;
  /** La punta del cliente. Se le pasa al gateway. */
  transporte: Transport;
}

export async function montarDemoEnMemoria(opciones: OpcionesServidorDemo): Promise<DemoEnMemoria> {
  const demo = crearServidorDemo(opciones);
  const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
  await demo.servidor.connect(delServidor);
  return { demo, transporte: delCliente };
}
