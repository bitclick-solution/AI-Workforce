/**
 * Sin credenciales en código, prompts ni registros, comprobado por prueba.
 *
 * Dos comprobaciones: que el paquete no tiene ninguna credencial escrita, y que
 * el valor de `ODOO_CLAVE_API` no aparece en nada de lo que el conector saca
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
import { cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { NOMBRES_CONCILIACION } from './conciliacion.js';
import { NOMBRES } from './herramientas.js';
import { crearServidor } from './servidor.js';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

/** Clave sembrada, larga y reconocible. No es una credencial real de nada. */
const CLAVE_SEMBRADA = 'clave-de-prueba-0d1a9f7c3b5e';

function ficherosDelPaquete(directorio: string): string[] {
  return readdirSync(directorio).flatMap((entrada) => {
    if (entrada === 'node_modules' || entrada === 'dist' || entrada === '.turbo') return [];
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) return ficherosDelPaquete(ruta);
    return /\.(ts|json|md)$/.test(entrada) ? [ruta] : [];
  });
}

describe('sin secretos en @aiw/connector-odoo', () => {
  const ficheros = ficherosDelPaquete(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(ficheros.length).toBeGreaterThan(8);
  });

  it('ninguna credencial de Odoo está escrita en el código', () => {
    const sospechosos = ficheros.filter((ruta) => {
      const contenido = readFileSync(ruta, 'utf8');
      // Una asignación de credencial con valor literal largo, en cualquier forma.
      return /(clave_?api|password|contrasena|api_?key|secret)\s*[:=]\s*['"][^'"\n]{8,}['"]/i.test(
        contenido.replaceAll(CLAVE_SEMBRADA, 'SEMBRADA'),
      );
    });
    expect(sospechosos, `Credenciales literales en: ${sospechosos.join(', ')}`).toEqual([]);
  });

  it('las cuatro variables se leen del entorno y no de otro sitio', () => {
    const entorno = readFileSync(join(RAIZ, 'src/entorno.ts'), 'utf8');
    for (const variable of VARIABLES) expect(entorno).toContain(`'${variable}'`);
  });

  it('ODOO_URL con credenciales dentro se rechaza', () => {
    expect(() =>
      leerConfiguracion({
        ODOO_URL: `https://aiw:${CLAVE_SEMBRADA}@odoo.local`,
        ODOO_BASE: 'pruebas',
        ODOO_USUARIO: 'agente',
        ODOO_CLAVE_API: CLAVE_SEMBRADA,
      }),
    ).toThrow(/no puede llevar usuario ni contraseña/);
  });

  it('el mensaje de lo que falta nombra las variables y no sus valores', () => {
    try {
      leerConfiguracion({ ODOO_URL: 'https://odoo.local', ODOO_CLAVE_API: CLAVE_SEMBRADA });
      expect.unreachable('faltaban variables');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('ODOO_BASE');
      expect(mensaje).not.toContain(CLAVE_SEMBRADA);
    }
  });

  it('una clave más corta que la redacción no se acepta', () => {
    const corta = 'abc123';
    expect(corta.length).toBeLessThan(LONGITUD_MINIMA_SECRETO);
    try {
      leerConfiguracion({
        ODOO_URL: 'https://odoo.local',
        ODOO_BASE: 'pruebas',
        ODOO_USUARIO: 'agente',
        ODOO_CLAVE_API: corta,
      });
      expect.unreachable('la clave corta debía rechazarse');
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).toContain('ODOO_CLAVE_API');
      expect(mensaje).not.toContain(corta);
    }
  });

  it('la redacción tapa el secreto y deja en paz el texto corto', () => {
    expect(redactar(`token=${CLAVE_SEMBRADA}`, [CLAVE_SEMBRADA])).toBe(`token=${MARCA_OCULTA}`);
    expect(redactar('el usuario es agente', ['agente'])).toBe('el usuario es agente');
  });
});

describe('la clave no sale del proceso', () => {
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
      // El MCP dinámico devuelve un fallo que repite la clave: el peor caso.
      // El fallo del ERP al leer el apunte repite la clave: el peor caso en conciliación.
      search_records: [
        {
          argumentos: { model: 'account.bank.statement.line', domain: [['id', '=', 55]] },
          error: `Authentication failed for api_key=${CLAVE_SEMBRADA} on database pruebas`,
        },
        ...(cargarGrabaciones()['search_records'] ?? []),
      ],
      chatter_post: [
        {
          argumentos: { record_id: 55 },
          error: `Authentication failed for api_key=${CLAVE_SEMBRADA} on database pruebas`,
        },
        ...(cargarGrabaciones()['chatter_post'] ?? []),
      ],
    };
    const servidor = crearServidor({
      herramientas: crearHerramientas({ cliente: clienteGrabado(grabaciones) }),
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
          .callTool({ name: NOMBRES.nota, arguments: { factura_id: 55, texto: 'Aviso.' } })
          .catch((error: unknown) => ({ error: String(error), datos: error })),
      ),
    );
    // Las dos herramientas de conciliación: lectura, y escritura con el fallo del peor caso.
    registrado.push(
      JSON.stringify(
        await cliente.callTool({ name: NOMBRES_CONCILIACION.extracto, arguments: {} }),
      ),
    );
    registrado.push(
      JSON.stringify(
        await cliente
          .callTool({
            name: NOMBRES_CONCILIACION.asiento,
            arguments: {
              apunte_id: '55',
              documento_id: '46',
              importe_diferencia: -12,
              cuenta_contrapartida: '629000',
              motivo: 'Comisión.',
            },
          })
          .catch((error: unknown) => ({ error: String(error), datos: error })),
      ),
    );
    await cliente.close();

    const todo = [...registrado, ...salida].join('\n');
    expect(todo).toContain(MARCA_OCULTA);
    expect(todo).not.toContain(CLAVE_SEMBRADA);
  });
});
