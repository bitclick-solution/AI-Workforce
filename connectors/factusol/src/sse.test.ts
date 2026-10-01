/** El cliente habla SSE y lleva el JWT del agente y el tenant en cada llamada. */
import { createServer, type IncomingMessage, type Server as ServidorHttp } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { clienteSse } from './cliente.js';
import { OPERACION_CONFIRMAR } from './confirmacion.js';
import { simularFactusol } from './simulador.js';
import { montarConector, principal } from './servidor.js';

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

  it('FACTUSOL_CONFIRMACION con un valor desconocido no arranca', async () => {
    const parte = (objeto: unknown): string =>
      Buffer.from(JSON.stringify(objeto)).toString('base64url');
    await expect(
      principal({
        AIW_CONECTOR_FACTUSOL: '1',
        FACTUSOL_CONFIRMACION: 'C',
        FACTUSOL_MCP_URL: 'https://factusol.local/sse',
        FACTUSOL_TENANT_ID: 't',
        FACTUSOL_MCP_TOKEN: `${parte({ alg: 'HS256' })}.${parte({ scope: 'lectura' })}.firma-de-prueba`,
      }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
  });
});

describe('dos credenciales, cada una en su sitio', () => {
  const parte = (objeto: unknown): string =>
    Buffer.from(JSON.stringify(objeto)).toString('base64url');
  const AGENTE = `${parte({ alg: 'HS256' })}.${parte({ scope: 'lectura' })}.firma-del-agente-0001`;
  const CONFIRMAR = `${parte({ alg: 'HS256' })}.${parte({ scope: 'confirmar' })}.firma-de-confirmar-0002`;

  /** Factusol simulado por SSE que anota con qué Bearer llegó cada llamada a una herramienta. */
  async function levantarSimulado(): Promise<{
    url: string;
    llamadas: { herramienta: string; auth: string | undefined }[];
  }> {
    const sim = simularFactusol();
    const llamadas: { herramienta: string; auth: string | undefined }[] = [];
    const autorizacionPorPeticion = new Map<string | number, string | undefined>();
    const transportes = new Map<string, SSEServerTransport>();
    http = createServer((peticion, respuesta) => {
      const ruta = new URL(peticion.url ?? '/', 'http://x');
      if (peticion.method === 'GET' && ruta.pathname === '/sse') {
        const transporte = new SSEServerTransport('/mensajes', respuesta);
        transportes.set(transporte.sessionId, transporte);
        const servidor = new Server(
          { name: 'falso', version: '0' },
          { capabilities: { tools: {} } },
        );
        servidor.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
        servidor.setRequestHandler(CallToolRequestSchema, async (p, extra) => {
          const auth = autorizacionPorPeticion.get(extra.requestId);
          llamadas.push({ herramienta: p.params.name, auth });
          const via = auth === `Bearer ${CONFIRMAR}` ? 'confirmar' : 'agente';
          try {
            const r = await sim.responder(via, p.params.name, p.params.arguments ?? {});
            return {
              content: [{ type: 'text', text: r.texto }],
              ...(r.estructurado === undefined
                ? {}
                : { structuredContent: r.estructurado as Record<string, unknown> }),
            };
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: String(error) }] };
          }
        });
        void servidor.connect(transporte);
        return;
      }
      const trozos: Buffer[] = [];
      peticion.on('data', (trozo: Buffer) => trozos.push(trozo));
      peticion.on('end', () => {
        const cuerpo: unknown = JSON.parse(Buffer.concat(trozos).toString('utf8'));
        const mensaje = cuerpo as { id?: string | number; method?: string };
        if (mensaje.method === 'tools/call' && mensaje.id !== undefined) {
          autorizacionPorPeticion.set(mensaje.id, peticion.headers.authorization);
        }
        void transportes
          .get(ruta.searchParams.get('sessionId') ?? '')
          ?.handlePostMessage(peticion, respuesta, cuerpo);
      });
    });
    await new Promise<void>((resolver) => http?.listen(0, '127.0.0.1', resolver));
    const { port } = http.address() as AddressInfo;
    return { url: `http://127.0.0.1:${String(port)}/sse`, llamadas };
  }

  async function conectar(opciones: { confirmar: boolean }): Promise<{
    cliente: Client;
    llamadas: { herramienta: string; auth: string | undefined }[];
  }> {
    const { url, llamadas } = await levantarSimulado();
    const { servidor } = montarConector(
      {
        extremoMcp: url,
        token: AGENTE,
        tenantId: 'tenant-de-prueba',
        ...(opciones.confirmar ? { tokenConfirmar: CONFIRMAR } : {}),
      },
      'B',
    );
    const cliente = new Client({ name: 'prueba', version: '0.0.0' });
    const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
    await Promise.all([servidor.connect(delServidor), cliente.connect(delCliente)]);
    return { cliente, llamadas };
  }

  it('el token de confirmación solo viaja con confirmar_operacion y el del agente nunca con ella', async () => {
    const { cliente, llamadas } = await conectar({ confirmar: true });
    const resultado = await cliente.callTool({
      name: 'crear_nota_seguimiento',
      arguments: { factura_id: '1-000101', texto: 'Aviso.' },
    });
    await cliente.close();

    expect((resultado.structuredContent as { id: string }).id).toBe('BORR-0002');
    const confirmaciones = llamadas.filter((l) => l.herramienta === OPERACION_CONFIRMAR);
    expect(confirmaciones).toHaveLength(1);
    expect(confirmaciones[0]?.auth).toBe(`Bearer ${CONFIRMAR}`);
    const resto = llamadas.filter((l) => l.herramienta !== OPERACION_CONFIRMAR);
    expect(resto.length).toBeGreaterThan(3);
    expect(resto.every((l) => l.auth === `Bearer ${AGENTE}`)).toBe(true);
  });

  it('sin el token de confirmación la escritura falla como no_autorizado y no llega a Factusol', async () => {
    const { cliente, llamadas } = await conectar({ confirmar: false });
    await expect(
      cliente.callTool({
        name: 'crear_nota_seguimiento',
        arguments: { factura_id: '1-000101', texto: 'Aviso.' },
      }),
    ).rejects.toMatchObject({ data: { motivo: 'no_autorizado', reintentable: false } });
    await cliente.close();
    expect(llamadas).toHaveLength(0);
  });
});
