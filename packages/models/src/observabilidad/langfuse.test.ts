import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  crearObservadorLangfuse,
  observadorDesdeEntorno,
  observadorEnMemoria,
  observadorNulo,
} from './langfuse.js';

const EVENTO = {
  tareaRaizId: '01929f00-0000-7000-8000-0000000000aa',
  puestoId: '01929f00-0000-7000-8000-0000000000bb',
  versionPuestoId: '01929f00-0000-7000-8000-0000000000cc',
  modelo: 'claude-sonnet-5',
  plataforma: 'bedrock-eu',
  tokens: { entrada: 1000, salida: 200, entradaCache: 100 },
  costeEuros: 0.0042,
};

describe('observadorNulo y observadorEnMemoria', () => {
  it('el nulo no lanza aunque no haya nada configurado', async () => {
    await expect(observadorNulo().registrarCosteDeTarea(EVENTO)).resolves.toBeUndefined();
  });

  it('el de memoria guarda el evento tal cual, para pruebas', async () => {
    const observador = observadorEnMemoria();
    await observador.registrarCosteDeTarea(EVENTO);
    expect(observador.eventos).toEqual([EVENTO]);
  });
});

describe('crearObservadorLangfuse', () => {
  let servidor: Server | undefined;
  let url = '';

  afterEach(async () => {
    if (servidor) await new Promise<void>((resolve) => servidor?.close(() => resolve()));
    servidor = undefined;
  });

  async function arrancarServidorDeIngestion(
    manejador: (cuerpo: unknown, cabeceras: Record<string, string | string[] | undefined>) => void,
  ): Promise<void> {
    servidor = createServer((peticion, respuesta) => {
      const trozos: Buffer[] = [];
      peticion.on('data', (trozo: Buffer) => trozos.push(trozo));
      peticion.on('end', () => {
        const cuerpo: unknown = JSON.parse(Buffer.concat(trozos).toString('utf8'));
        manejador(cuerpo, peticion.headers);
        respuesta.writeHead(200, { 'content-type': 'application/json' });
        respuesta.end(JSON.stringify({ successes: [], errors: [] }));
      });
    });
    await new Promise<void>((resolve) => servidor?.listen(0, '127.0.0.1', resolve));
    const direccion = servidor.address();
    if (direccion === null || typeof direccion === 'string') throw new Error('sin puerto');
    url = `http://127.0.0.1:${direccion.port}`;
  }

  it('manda el coste con autenticación básica y los tokens desglosados', async () => {
    let recibido: unknown;
    let cabecerasRecibidas: Record<string, string | string[] | undefined> = {};
    await arrancarServidorDeIngestion((cuerpo, cabeceras) => {
      recibido = cuerpo;
      cabecerasRecibidas = cabeceras;
    });

    const claveBase64 = Buffer.from('publica:secreta', 'utf8').toString('base64');
    const observador = crearObservadorLangfuse({ claveBase64, baseUrl: url, fetch });
    await observador.registrarCosteDeTarea(EVENTO);

    expect(cabecerasRecibidas['authorization']).toBe(`Basic ${claveBase64}`);
    const cuerpo = recibido as {
      batch: { body: { usageDetails: Record<string, number>; costDetails: { total: number } } }[];
    };
    expect(cuerpo.batch[0]?.body.usageDetails).toEqual({
      input: 1000,
      output: 200,
      input_cached: 100,
    });
    expect(cuerpo.batch[0]?.body.costDetails.total).toBe(0.0042);
  });

  it('lanza si Langfuse rechaza el envío', async () => {
    servidor = createServer((_peticion, respuesta) => {
      respuesta.writeHead(401);
      respuesta.end('no autorizado');
    });
    await new Promise<void>((resolve) => servidor?.listen(0, '127.0.0.1', resolve));
    const direccion = servidor.address();
    if (direccion === null || typeof direccion === 'string') throw new Error('sin puerto');
    const observador = crearObservadorLangfuse({
      claveBase64: 'x',
      baseUrl: `http://127.0.0.1:${direccion.port}`,
      fetch,
    });

    await expect(observador.registrarCosteDeTarea(EVENTO)).rejects.toThrow(/Langfuse rechazó/);
  });
});

describe('observadorDesdeEntorno', () => {
  it('sin credenciales, devuelve el observador nulo', async () => {
    const observador = observadorDesdeEntorno({});
    await expect(observador.registrarCosteDeTarea(EVENTO)).resolves.toBeUndefined();
  });
});
