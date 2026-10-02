/**
 * Los tres transportes, con el secreto entrando por la conexión y no por la llamada.
 *
 * Esta es la prueba que sostiene la frontera de credenciales del gateway. No
 * comprueba que el secreto «no se vea», que es fácil de escribir y difícil de
 * creer: comprueba que el conector **exige** la credencial correcta y responde, lo
 * que solo puede pasar si le llegó por donde tiene que llegarle. Con un secreto
 * equivocado el conector se niega, y ese es el contraejemplo.
 *
 * El proceso hijo y el HTTP corren de verdad: uno lanza `tsx` sobre el conector y el
 * otro abre un puerto en el bucle local. Nada de esto sale de la máquina.
 */
import { fileURLToPath } from 'node:url';

import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  NOMBRE_CONECTOR_DEMO,
  VARIABLE_SECRETO_DEMO,
  montarDemoEnMemoria,
  servirDemoPorHttp,
} from '@aiw/connector-demo';
import { describe, expect, it } from 'vitest';

import { conectarPorMcp } from '../cliente-mcp.js';
import { Secreto } from '../secretos.js';
import { conexionPorHttp, conexionPorProcesoHijo } from '../transportes.js';

const SECRETO = 'transporte-de-prueba-9f3a1c';

/** Raíz del conector de demostración, para lanzarlo como proceso hijo. */
const RAIZ_CONECTOR = fileURLToPath(new URL('../../../../connectors/demo/', import.meta.url));

interface Listado {
  facturas: { numero: string; dias_vencida: number }[];
  total: number;
}

describe('transporte en memoria', () => {
  it('descubre y llama con la credencial que trae la conexión', async () => {
    const { transporte } = await montarDemoEnMemoria({
      credencial: SECRETO,
      credencialEsperada: SECRETO,
    });
    const conexion = await conectarPorMcp(transporte, NOMBRE_CONECTOR_DEMO);

    const herramientas = await conexion.listar();
    // Las dos de cobros y las dos de conciliación bancaria.
    expect(herramientas.map((herramienta) => herramienta.nombre).sort()).toEqual(
      [
        HERRAMIENTA_NOTA,
        HERRAMIENTA_LISTAR,
        'leer_extracto_bancario',
        'proponer_asiento_diferencia',
      ].sort(),
    );
    await conexion.cerrar();
  });
});

describe('transporte por proceso hijo', () => {
  it('lanza el conector, le inyecta el secreto en el entorno y habla con él', async () => {
    const conexion = await conexionPorProcesoHijo(
      NOMBRE_CONECTOR_DEMO,
      new Secreto(`env:${VARIABLE_SECRETO_DEMO}`, SECRETO),
      {
        comando: 'pnpm',
        argumentos: ['exec', 'tsx', 'src/main.ts'],
        variableDelSecreto: VARIABLE_SECRETO_DEMO,
        directorio: RAIZ_CONECTOR,
      },
    );

    const herramientas = await conexion.listar();
    expect(herramientas.map((herramienta) => herramienta.nombre)).toContain(HERRAMIENTA_LISTAR);

    const resultado = await conexion.llamar(HERRAMIENTA_LISTAR, {});
    const carga = JSON.parse(resultado.texto) as Listado;
    expect(carga.total).toBe(3);
    expect(carga.facturas[0]?.numero).toBe('F-2026-0001');

    await conexion.cerrar();
  }, 120_000);

  it('el conector no arranca sin el secreto: el proceso hijo se niega', async () => {
    // Sin secreto, `main.ts` sale con código 1 antes de hablar el protocolo, así que
    // el cliente no consigue abrir la conexión.
    await expect(
      conexionPorProcesoHijo(NOMBRE_CONECTOR_DEMO, null, {
        comando: 'pnpm',
        argumentos: ['exec', 'tsx', 'src/main.ts'],
        variableDelSecreto: VARIABLE_SECRETO_DEMO,
        directorio: RAIZ_CONECTOR,
      }),
    ).rejects.toThrow();
  }, 120_000);
});

describe('transporte por HTTP transmisible', () => {
  it('habla con un conector que ya está corriendo', async () => {
    const servido = await servirDemoPorHttp({
      credencial: SECRETO,
      credencialEsperada: SECRETO,
      puerto: 0,
    });

    try {
      const conexion = await conexionPorHttp(
        NOMBRE_CONECTOR_DEMO,
        new Secreto(`env:${VARIABLE_SECRETO_DEMO}`, SECRETO),
        { url: servido.url },
      );

      const herramientas = await conexion.listar();
      expect(herramientas).toHaveLength(4);

      const resultado = await conexion.llamar(HERRAMIENTA_NOTA, {
        factura_id: 'inv-0002',
        texto: 'Te escribimos por la factura F-2026-0002. ¿Nos confirmas el pago?',
      });
      expect(resultado.esError).toBe(false);
      expect(servido.demo.notas).toHaveLength(1);

      await conexion.cerrar();
    } finally {
      await servido.cerrar();
    }
  }, 60_000);

  it('el fallo del conector llega con su motivo por HTTP igual que en memoria', async () => {
    const servido = await servirDemoPorHttp({
      credencial: SECRETO,
      credencialEsperada: SECRETO,
      puerto: 0,
      fallosIniciales: 1,
    });

    try {
      const conexion = await conexionPorHttp(NOMBRE_CONECTOR_DEMO, null, { url: servido.url });
      const resultado = await conexion.llamar(HERRAMIENTA_LISTAR, {});

      expect(resultado.esError).toBe(true);
      expect(resultado.texto).toContain('"motivo":"temporal"');
      await conexion.cerrar();
    } finally {
      await servido.cerrar();
    }
  }, 60_000);
});
