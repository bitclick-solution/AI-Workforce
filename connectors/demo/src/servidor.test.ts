import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { FACTURAS_DEMO, facturasVencidas } from './datos.js';
import {
  CredencialDemoNoValida,
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  crearServidorDemo,
  type OpcionesServidorDemo,
} from './servidor.js';

const CREDENCIAL = 'credencial-de-prueba-generada';

async function conectar(opciones: Partial<OpcionesServidorDemo> = {}) {
  const demo = crearServidorDemo({
    credencial: CREDENCIAL,
    credencialEsperada: CREDENCIAL,
    ...opciones,
  });
  const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'prueba', version: '0.0.0' });
  await Promise.all([demo.servidor.connect(delServidor), cliente.connect(delCliente)]);
  return { demo, cliente };
}

function textoDe(resultado: Record<string, unknown>): string {
  const contenido = resultado['content'] as { type: string; text?: string }[] | undefined;
  return contenido?.map((parte) => parte.text ?? '').join('') ?? '';
}

describe('conector de demostración · protocolo MCP', () => {
  it('descubre las dos herramientas con su clasificación de lectura y escritura', async () => {
    const { cliente } = await conectar();
    const { tools } = await cliente.listTools();
    const porNombre = new Map(tools.map((h) => [h.name, h]));

    expect([...porNombre.keys()].sort()).toEqual([HERRAMIENTA_NOTA, HERRAMIENTA_LISTAR].sort());
    expect(porNombre.get(HERRAMIENTA_LISTAR)?.annotations?.readOnlyHint).toBe(true);
    expect(porNombre.get(HERRAMIENTA_NOTA)?.annotations?.readOnlyHint).toBe(false);
    await cliente.close();
  });

  it('lista solo las facturas vencidas, con los días de retraso', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const { facturas } = JSON.parse(textoDe(resultado)) as {
      facturas: { numero: string; diasDeRetraso: number }[];
    };

    expect(facturas).toHaveLength(3);
    expect(facturas.map((f) => f.numero)).toEqual(facturasVencidas().map((f) => f.numero));
    expect(facturas.every((f) => f.diasDeRetraso > 0)).toBe(true);
    expect(facturas.length).toBeLessThan(FACTURAS_DEMO.length);
    await cliente.close();
  });

  it('guarda la nota de seguimiento de una factura que existe', async () => {
    const { demo, cliente } = await conectar();
    await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura: 'F-2026-0001', texto: 'Te escribimos para recordarte el pago.' },
    });

    expect(demo.notas).toHaveLength(1);
    expect(demo.notas[0]?.factura).toBe('F-2026-0001');
    await cliente.close();
  });

  it('devuelve error de herramienta si la factura no existe, sin guardar nada', async () => {
    const { demo, cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura: 'F-9999-9999', texto: 'Nota imposible.' },
    });

    expect(resultado.isError).toBe(true);
    expect(demo.notas).toHaveLength(0);
    await cliente.close();
  });

  it('falla las primeras llamadas cuando se le inyecta el fallo, y luego responde', async () => {
    const { demo, cliente } = await conectar({ fallosIniciales: 2 });

    // MCP no propaga la excepción: el fallo de una herramienta viaja como
    // resultado con `isError`. Quien lo convierte en un error del que Temporal se
    // pueda enterar es el gateway, no el protocolo.
    const primera = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const segunda = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const tercera = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });

    expect(primera.isError).toBe(true);
    expect(segunda.isError).toBe(true);
    expect(tercera.isError).toBeFalsy();
    expect(textoDe(tercera)).toContain('F-2026-0001');
    expect(demo.llamadas.get(HERRAMIENTA_LISTAR)).toBe(3);
    await cliente.close();
  });

  it('rechaza la conexión con una credencial que no cuadra, sin decir cuál era', () => {
    let capturado: unknown;
    try {
      crearServidorDemo({ credencial: 'otra', credencialEsperada: CREDENCIAL });
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(CredencialDemoNoValida);
    expect(String(capturado)).not.toContain(CREDENCIAL);
    expect(String(capturado)).not.toContain('otra');
  });
});
