/**
 * Pruebas de contrato.
 *
 * El mismo cuerpo corre contra la instancia de pruebas de Odoo cuando el
 * entorno trae las cuatro variables, y contra las respuestas grabadas cuando
 * no, que es lo que pasa en la integración continua. Sin entorno, la parte
 * contra Odoo se salta con un mensaje que dice qué falta, igual que las
 * pruebas de base de datos sin `DATABASE_URL`.
 */
import { describe, expect, it } from 'vitest';

import { clienteGrabado, clienteHttp, type ClienteMcpDinamico } from './cliente.js';
import { MOTIVO_SALTO, hayCredenciales, leerConfiguracion } from './entorno.js';
import { SalidaCrearNotaSeguimiento, SalidaListarFacturasVencidas } from './esquemas.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas, type Herramientas } from './herramientas.js';

const CONTRA_ODOO = hayCredenciales();

/** Una factura de la instancia de pruebas sobre la que se puede escribir. */
const FACTURA_DE_PRUEBA = Number(process.env['ODOO_FACTURA_PRUEBA'] ?? '0');

/** Invariantes que valen igual contra Odoo y contra las grabaciones. */
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
  });

  it('listar_facturas_vencidas cumple el contrato', async () => {
    verificarLista(await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 2 }), 2);
  });

  it('listar_facturas_vencidas cumple el contrato con la envolvente «result» del MCP real', async () => {
    // El servidor real (FastMCP) devuelve la lista bajo «result», no «records»;
    // esta grabación la usa para que la CI no dependa de una forma supuesta.
    verificarLista(await herramientas.listarFacturasVencidas({ limite: 3 }), 1);
  });

  it('crear_nota_seguimiento cumple el contrato', async () => {
    const salida = await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Nota de contrato.',
    });
    // El `chatter_post` real devuelve `record_id` (la factura) junto al
    // identificador creado bajo `result`: el `id` de la salida debe ser este
    // último, no la factura sobre la que se escribió.
    expect(SalidaCrearNotaSeguimiento.parse(salida)).toMatchObject({ id: 9001, factura_id: 42 });
  });

  it('las grabaciones no llevan datos personales reales', () => {
    const crudo = JSON.stringify(cargarGrabaciones());
    expect(crudo).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(crudo).not.toMatch(/\b[0-9]{8}[A-Z]\b/);
    expect(crudo).not.toMatch(/\b(?:\+34|6|7)\d{8}\b/);
  });
});

const TITULO = CONTRA_ODOO
  ? 'contrato contra la instancia de pruebas de Odoo'
  : `contrato contra la instancia de pruebas de Odoo — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!CONTRA_ODOO)(TITULO, () => {
  let cliente: ClienteMcpDinamico | undefined;

  function conectar(): Herramientas {
    const configuracion = leerConfiguracion();
    cliente ??= clienteHttp({ extremo: configuracion.extremoMcp });
    return crearHerramientas({ cliente });
  }

  it('listar_facturas_vencidas cumple el contrato contra el ERP real', async () => {
    verificarLista(
      await conectar().listarFacturasVencidas({ dias_vencida_minimo: 1, limite: 5 }),
      1,
    );
  }, 60_000);

  it.skipIf(FACTURA_DE_PRUEBA <= 0)(
    'crear_nota_seguimiento escribe una vez por clave de idempotencia',
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
      const segunda = await herramientas.crearNotaSeguimiento(entrada);
      expect(segunda).toEqual(primera);
    },
    60_000,
  );

  it('una factura inexistente sale como no_encontrada', async () => {
    await expect(
      conectar().crearNotaSeguimiento({ factura_id: 999_999_999, texto: 'Nota de contrato.' }),
    ).rejects.toMatchObject({ motivo: 'no_encontrada' });
  }, 60_000);
});
