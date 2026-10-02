/**
 * Pruebas de contrato.
 *
 * El mismo cuerpo corre contra la instancia de pruebas de Factusol MCP cuando el
 * entorno trae las tres variables, y contra las respuestas grabadas cuando no, que
 * es lo que pasa en la CI. Sin entorno, la parte contra Factusol se salta con un
 * mensaje que dice qué falta.
 *
 * Contra la instancia real el vencimiento se deriva de la forma de pago de cada factura.
 * La nota se escribe solo como borrador, que caduca a los 30 minutos si nadie lo
 * confirma, y solo si hay `FACTUSOL_FACTURA_PRUEBA` (serie-número de una factura de
 * la empresa de pruebas).
 */
import { describe, expect, it } from 'vitest';

import { clienteGrabado, clienteSse, type ClienteFactusol } from './cliente.js';
import { MOTIVO_SALTO, hayCredenciales, leerConfiguracion } from './entorno.js';
import { SalidaCrearNotaSeguimiento, SalidaListarFacturasVencidas } from './esquemas.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas, type Herramientas } from './herramientas.js';

const CONTRA_FACTUSOL = hayCredenciales();
const FACTURA_DE_PRUEBA = process.env['FACTUSOL_FACTURA_PRUEBA'] ?? '';

function verificarLista(salida: unknown, minimo: number): void {
  const lista = SalidaListarFacturasVencidas.parse(salida);
  expect(lista.total).toBe(lista.facturas.length);
  for (const factura of lista.facturas) {
    expect(factura.dias_vencida).toBeGreaterThanOrEqual(Math.max(1, minimo));
    expect(factura.fecha_vencimiento >= factura.fecha_emision).toBe(true);
  }
  const dias = lista.facturas.map((factura) => factura.dias_vencida);
  expect(dias).toEqual([...dias].sort((una, otra) => otra - una));
}

describe('contrato sobre respuestas grabadas', () => {
  const herramientas = crearHerramientas({
    cliente: clienteGrabado(cargarGrabaciones()),
    ahora: () => DIA_DE_LA_GRABACION,
    registrar: () => undefined,
  });

  it('listar_facturas_vencidas cumple el contrato', async () => {
    verificarLista(await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 2 }), 2);
  });

  it('crear_nota_seguimiento cumple el contrato', async () => {
    const salida = await herramientas.crearNotaSeguimiento({
      factura_id: '1-000101',
      texto: 'Nota de contrato.',
    });
    expect(SalidaCrearNotaSeguimiento.parse(salida)).toMatchObject({
      id: 'dft_20260921_090000_a1b2c3',
      factura_id: '1-000101',
    });
  });

  it('la salida tiene la forma que lee el guion del caso dorado «cobros»', async () => {
    // El guion (`@aiw/models`) lee `FacturaParaNota`: id y cliente.id como cadena, número,
    // importe, moneda y días vencida. Sin importar el paquete: un conector solo habla por MCP.
    const { facturas } = await herramientas.listarFacturasVencidas({});
    expect(facturas.length).toBeGreaterThan(0);
    for (const factura of facturas) {
      expect(typeof factura.id).toBe('string');
      expect(typeof factura.numero).toBe('string');
      expect(typeof factura.cliente.id).toBe('string');
      expect(typeof factura.cliente.nombre).toBe('string');
      expect(typeof factura.importe_pendiente).toBe('number');
      expect(typeof factura.moneda).toBe('string');
      expect(typeof factura.dias_vencida).toBe('number');
    }
  });

  it('las grabaciones no llevan datos personales reales', () => {
    const crudo = JSON.stringify(cargarGrabaciones());
    expect(crudo).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(crudo).not.toMatch(/\b[0-9]{8}[A-Z]\b/);
    expect(crudo).not.toMatch(/\b(?:\+34|6|7)\d{8}\b/);
  });
});

const TITULO = CONTRA_FACTUSOL
  ? 'contrato contra la instancia de pruebas de Factusol MCP'
  : `contrato contra la instancia de pruebas de Factusol MCP — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!CONTRA_FACTUSOL)(TITULO, () => {
  let cliente: ClienteFactusol | undefined;

  function conectar(): Herramientas {
    const configuracion = leerConfiguracion();
    cliente ??= clienteSse({
      extremo: configuracion.extremoMcp,
      token: configuracion.token,
      tenantId: configuracion.tenantId,
    });
    return crearHerramientas({ cliente });
  }

  it('listar_facturas_vencidas cumple el contrato contra Factusol', async () => {
    verificarLista(
      await conectar().listarFacturasVencidas({ dias_vencida_minimo: 1, limite: 5 }),
      1,
    );
  }, 60_000);

  it.skipIf(FACTURA_DE_PRUEBA === '')(
    'crear_nota_seguimiento deja un borrador y escribe una vez por clave',
    async () => {
      const herramientas = conectar();
      const entrada = {
        factura_id: FACTURA_DE_PRUEBA,
        texto: `Nota de contrato del conector, ${new Date().toISOString()}.`,
        clave_idempotencia: `contrato-${String(Date.now())}`,
      };
      const primera = SalidaCrearNotaSeguimiento.parse(
        await herramientas.crearNotaSeguimiento(entrada),
      );
      expect(await herramientas.crearNotaSeguimiento(entrada)).toEqual(primera);
    },
    60_000,
  );

  it('una factura inexistente sale como no_encontrada', async () => {
    await expect(
      conectar().crearNotaSeguimiento({ factura_id: '1-999999', texto: 'Nota de contrato.' }),
    ).rejects.toMatchObject({ motivo: 'no_encontrada' });
  }, 60_000);
});
