/**
 * Sin credenciales en código, prompts ni registros, comprobado por prueba.
 *
 * Dos comprobaciones: que el paquete no tiene ninguna credencial escrita, y que
 * el valor de `FACTUSOL_MCP_TOKEN` no aparece en nada de lo que el conector saca
 * del proceso, ni en las respuestas, ni en los errores, ni en el registro.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clienteGrabado } from './cliente.js';
import {
  LONGITUD_MINIMA_SECRETO,
  MARCA_OCULTA,
  VARIABLES,
  leerConfiguracion,
  redactar,
} from './entorno.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { NOMBRES } from './herramientas.js';
import { crearServidor } from './servidor.js';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Clave sembrada, larga y reconocible. No es una credencial real de nada. */
const CLAVE_SEMBRADA = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"scope":"lectura"}').toString('base64url')}.firma-de-prueba-0d1a9f7c3b5e`;

function ficherosDelPaquete(directorio: string): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    if (entrada === 'node_modules' || entrada === 'dist' || entrada === '.turbo') return [];
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) return ficherosDelPaquete(ruta);
    return /\.(ts|json|md)$/.test(entrada) ? [ruta] : [];
  });
}

describe('sin secretos en @aiw/connector-factusol', () => {
  const ficheros = ficherosDelPaquete(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(ficheros.length).toBeGreaterThan(8);
  });

  it('ninguna credencial de Factusol está escrita en el código', () => {
    const sospechosos = ficheros.filter((ruta) => {
      const contenido = readFileSync(ruta, 'utf8');
      // Una asignación de credencial con valor literal largo, en cualquier forma.
      return /(clave_?api|password|contrasena|api_?key|secret)\s*[:=]\s*['"][^'"\n]{8,}['"]/i.test(
        contenido.replaceAll(CLAVE_SEMBRADA, 'SEMBRADA'),
      );
    });
    expect(sospechosos, `Credenciales literales en: ${sospechosos.join(', ')}`).toEqual([]);
  });

  it('las tres variables se leen del entorno y no de otro sitio', () => {
    const entorno = readFileSync(join(RAIZ, 'src/entorno.ts'), 'utf8');
    for (const variable of VARIABLES) expect(entorno).toContain(`'${variable}'`);
  });

  it('FACTUSOL_MCP_URL con credenciales dentro se rechaza', () => {
    expect(() =>
      leerConfiguracion({
        FACTUSOL_MCP_URL: 'https://aiw:clave-larga-1234@factusol.local/sse',
        FACTUSOL_MCP_TOKEN: CLAVE_SEMBRADA,
        FACTUSOL_TENANT_ID: 't',
      }),
    ).toThrow(/no puede llevar usuario ni contraseña/);
  });

  it('el mensaje de lo que falta nombra las variables y no sus valores', () => {
    try {
      leerConfiguracion({
        FACTUSOL_MCP_URL: 'https://factusol.local/sse',
        FACTUSOL_MCP_TOKEN: CLAVE_SEMBRADA,
      });
      expect.unreachable('faltaban variables');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('FACTUSOL_TENANT_ID');
      expect(mensaje).not.toContain(CLAVE_SEMBRADA);
    }
  });

  it('un token más corto que la redacción no se acepta', () => {
    const corto = 'abc123';
    expect(corto.length).toBeLessThan(LONGITUD_MINIMA_SECRETO);
    try {
      leerConfiguracion({
        FACTUSOL_MCP_URL: 'https://factusol.local/sse',
        FACTUSOL_MCP_TOKEN: corto,
        FACTUSOL_TENANT_ID: 't',
      });
      expect.unreachable('el token corto debía rechazarse');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('FACTUSOL_MCP_TOKEN');
      expect(mensaje).not.toContain(corto);
    }
  });

  it('la redacción tapa el secreto y deja en paz el texto corto', () => {
    expect(redactar(`token=${CLAVE_SEMBRADA}`, [CLAVE_SEMBRADA])).toBe(`token=${MARCA_OCULTA}`);
    expect(redactar('el usuario es agente', ['agente'])).toBe('el usuario es agente');
  });
});

describe('el token no sale del proceso', () => {
  const salida: string[] = [];

  beforeEach(() => {
    salida.length = 0;
    vi.spyOn(console, 'error').mockImplementation((...partes: unknown[]) => {
      salida.push(partes.map(String).join(' '));
    });
    for (const flujo of [process.stdout, process.stderr]) {
      vi.spyOn(flujo, 'write').mockImplementation((trozo: unknown) => {
        salida.push(String(trozo));
        return true;
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ni en las respuestas, ni en los errores, ni en el registro', async () => {
    const grabaciones = {
      ...cargarGrabaciones(),
      // Factusol MCP devuelve un fallo que repite el token: el peor caso.
      draft_modificar_cliente: [
        { error: `401 Unauthorized: token=${CLAVE_SEMBRADA} rechazado en el tenant` },
      ],
    };
    const servidor = crearServidor({
      herramientas: crearHerramientas({
        cliente: clienteGrabado(grabaciones),
        ahora: () => DIA_DE_LA_GRABACION,
      }),
      secretos: [CLAVE_SEMBRADA],
    });
    const cliente = new Client({ name: 'prueba', version: '0.0.0' });
    const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
    await Promise.all([servidor.connect(delServidor), cliente.connect(delCliente)]);

    const registrado: string[] = [];
    registrado.push(JSON.stringify(await cliente.listTools()));
    registrado.push(
      JSON.stringify(await cliente.callTool({ name: NOMBRES.listar, arguments: {} })),
    );
    registrado.push(
      JSON.stringify(
        await cliente
          .callTool({ name: NOMBRES.nota, arguments: { factura_id: '1-000101', texto: 'Aviso.' } })
          .catch((error: unknown) => ({ error: String(error), datos: error })),
      ),
    );
    await cliente.close();

    const todo = [...registrado, ...salida].join('\n');
    expect(todo).toContain(MARCA_OCULTA);
    expect(todo).not.toContain(CLAVE_SEMBRADA);
  });
});
