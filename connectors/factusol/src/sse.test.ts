/** El cliente habla SSE y lleva el JWT del agente y el tenant en cada llamada. */
import { createServer, type IncomingMessage, type Server as ServidorHttp } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { clienteSse } from './cliente.js';
import { principal } from './servidor.js';

const TOKEN = 'cabecera.carga.firma-de-prueba-sse';

let http: ServidorHttp | undefined;

afterEach(() => {
  http?.close();
  http = undefined;
});

async function levantar(): Promise<{
  url: string;
  cabeceras: (string | undefined)[];
  llamadas: Record<string, unknown>[];
}> {
  const cabeceras: (string | undefined)[] = [];
  const llamadas: Record<string, unknown>[] = [];
  const transportes = new Map<string, SSEServerTransport>();
  http = createServer((peticion: IncomingMessage, respuesta) => {
    cabeceras.push(peticion.headers.authorization);
    const ruta = new URL(peticion.url ?? '/', 'http://x');
    if (peticion.method === 'GET' && ruta.pathname === '/sse') {
      const transporte = new SSEServerTransport('/mensajes', respuesta);
      transportes.set(transporte.sessionId, transporte);
      const servidor = new Server({ name: 'falso', version: '0' }, { capabilities: { tools: {} } });
      servidor.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
      servidor.setRequestHandler(CallToolRequestSchema, (p) => {
        llamadas.push(p.params.arguments ?? {});
        return { content: [{ type: 'text', text: '**Factura 1-000123**' }] };
      });
      void servidor.connect(transporte);
      return;
    }
    const sesion = ruta.searchParams.get('sessionId') ?? '';
    void transportes.get(sesion)?.handlePostMessage(peticion, respuesta);
  });
  await new Promise<void>((resolver) => http?.listen(0, '127.0.0.1', resolver));
  const { port } = http.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/sse`, cabeceras, llamadas };
}

describe('cliente SSE', () => {
  it('lleva el Bearer en el flujo y en los POST, y añade tenant_id', async () => {
    const { url, cabeceras, llamadas } = await levantar();
    const cliente = clienteSse({ extremo: url, token: TOKEN, tenantId: 'tenant-de-prueba' });
    const respuesta = await cliente.llamar('get_factura', { serie: '1', numero: 123 });
    await cliente.cerrar();
    expect(respuesta.texto).toBe('**Factura 1-000123**');
    expect(llamadas).toEqual([{ tenant_id: 'tenant-de-prueba', serie: '1', numero: 123 }]);
    expect(cabeceras.length).toBeGreaterThanOrEqual(2);
    expect(cabeceras.every((cabecera) => cabecera === `Bearer ${TOKEN}`)).toBe(true);
  });
});

describe('arranque', () => {
  it('con la bandera apagada no abre nada ni lee el entorno', async () => {
    await expect(principal({})).resolves.toBeUndefined();
  });

  it('con la bandera encendida y un token con scope confirmar no arranca', async () => {
    const parte = (objeto: unknown): string =>
      Buffer.from(JSON.stringify(objeto)).toString('base64url');
    await expect(
      principal({
        AIW_CONECTOR_FACTUSOL: '1',
        FACTUSOL_MCP_URL: 'https://factusol.local/sse',
        FACTUSOL_TENANT_ID: 't',
        FACTUSOL_MCP_TOKEN: `${parte({ alg: 'HS256' })}.${parte({ scope: 'confirmar' })}.firma-de-prueba`,
      }),
    ).rejects.toMatchObject({ motivo: 'no_autorizado' });
  });

  it('FACTUSOL_CONFIRMACION=B no arranca todavía', async () => {
    const parte = (objeto: unknown): string =>
      Buffer.from(JSON.stringify(objeto)).toString('base64url');
    await expect(
      principal({
        AIW_CONECTOR_FACTUSOL: '1',
        FACTUSOL_CONFIRMACION: 'B',
        FACTUSOL_MCP_URL: 'https://factusol.local/sse',
        FACTUSOL_TENANT_ID: 't',
        FACTUSOL_MCP_TOKEN: `${parte({ alg: 'HS256' })}.${parte({ scope: 'lectura' })}.firma-de-prueba`,
      }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
  });
});
