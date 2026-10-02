/**
 * El servidor MCP: qué anuncia y cómo salen los errores por el protocolo.
 *
 * Un fallo debe llegar al gateway como error MCP con código, mensaje en
 * español y `datos.motivo`, no como texto dentro de un resultado correcto.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { clienteGrabado } from './cliente.js';
import { CODIGO_POR_MOTIVO, esReintentable } from './errores.js';
import { ESQUEMA_ENTRADA_LISTAR, ESQUEMA_ENTRADA_NOTA } from './esquema-json.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { NOMBRES, crearHerramientas } from './herramientas.js';
import { CATALOGO, crearServidor } from './servidor.js';

async function conectar(): Promise<Client> {
  const servidor = crearServidor({
    herramientas: crearHerramientas({
      cliente: clienteGrabado(cargarGrabaciones()),
      ahora: () => DIA_DE_LA_GRABACION,
    }),
  });
  const cliente = new Client({ name: 'prueba', version: '0.0.0' });
  const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
  await Promise.all([servidor.connect(delServidor), cliente.connect(delCliente)]);
  return cliente;
}

describe('catálogo del conector', () => {
  it('anuncia exactamente dos herramientas', async () => {
    const cliente = await conectar();
    const { tools } = await cliente.listTools();
    expect(tools.map((herramienta) => herramienta.name)).toEqual([NOMBRES.listar, NOMBRES.nota]);
    expect(tools.every((herramienta) => (herramienta.description ?? '').length > 20)).toBe(true);
    await cliente.close();
  });

  it('listar_facturas_vencidas se anuncia de solo lectura; crear_nota_seguimiento, de escritura', async () => {
    // Sin `readOnlyHint: true` el gateway MCP tipa cualquier herramienta como
    // escritura (lo más restrictivo por defecto) y pediría aprobación N1 hasta
    // para leer las facturas vencidas.
    const cliente = await conectar();
    const { tools } = await cliente.listTools();
    const listar = tools.find((herramienta) => herramienta.name === NOMBRES.listar);
    const nota = tools.find((herramienta) => herramienta.name === NOMBRES.nota);
    expect(listar?.annotations?.readOnlyHint).toBe(true);
    expect(nota?.annotations?.readOnlyHint).toBe(false);
    await cliente.close();
  });

  it('el esquema anunciado dice lo mismo que el esquema que valida', () => {
    expect(CATALOGO[0].inputSchema).toBe(ESQUEMA_ENTRADA_LISTAR);
    expect(CATALOGO[1].inputSchema).toBe(ESQUEMA_ENTRADA_NOTA);
    expect(ESQUEMA_ENTRADA_LISTAR.properties.dias_vencida_minimo.default).toBe(1);
    expect(ESQUEMA_ENTRADA_LISTAR.properties.limite.maximum).toBe(200);
    expect(ESQUEMA_ENTRADA_NOTA.properties.texto.maxLength).toBe(2000);
    expect([...ESQUEMA_ENTRADA_NOTA.required]).toEqual(['factura_id', 'texto']);
  });
});

describe('resultados y errores por el protocolo', () => {
  it('una lectura correcta viaja como contenido estructurado', async () => {
    const cliente = await conectar();
    const resultado = await cliente.callTool({ name: NOMBRES.listar, arguments: {} });
    expect(resultado.isError).toBeUndefined();
    expect((resultado.structuredContent as { total: number }).total).toBe(3);
    await cliente.close();
  });

  it.each([
    [
      'entrada inválida',
      { name: NOMBRES.nota, arguments: { factura_id: 42, texto: '' } },
      'invalido',
    ],
    [
      'factura inexistente',
      { name: NOMBRES.nota, arguments: { factura_id: 999999, texto: 'Aviso.' } },
      'no_encontrada',
    ],
    ['herramienta que no sirve', { name: 'borrar_factura', arguments: {} }, 'no_encontrada'],
  ] as const)('%s sale como error MCP con motivo %s', async (_caso, peticion, motivo) => {
    const cliente = await conectar();
    try {
      await cliente.callTool(peticion);
      expect.unreachable('la llamada debía fallar');
    } catch (error) {
      const fallo = error as { code: number; message: string; data?: unknown };
      expect(fallo.code).toBe(CODIGO_POR_MOTIVO[motivo]);
      expect(fallo.data).toEqual({ motivo, reintentable: esReintentable(motivo) });
      expect(fallo.message).toMatch(/[áéíóúñ¿]|No se pudo|Entrada inválida|no sirve/i);
    }
    await cliente.close();
  });

  it('un fallo pasajero del ERP se anuncia como reintentable', async () => {
    const cliente = await conectar();
    await expect(
      cliente.callTool({ name: NOMBRES.nota, arguments: { factura_id: 777777, texto: 'Aviso.' } }),
    ).rejects.toMatchObject({ code: CODIGO_POR_MOTIVO.temporal, data: { reintentable: true } });
    await cliente.close();
  });
});
