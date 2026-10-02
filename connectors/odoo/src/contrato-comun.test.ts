/**
 * El contrato de conciliación es uno solo: `connectors/odoo` y `connectors/demo`
 * (la referencia) no pueden separarse en forma. Factusol queda fuera: Factusol
 * MCP no tiene movimientos bancarios ni asientos (ver el README del conector).
 *
 * `@aiw/connector-demo` es dependencia de desarrollo solo para esta prueba; el
 * código del conector no lo importa.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as demo from '@aiw/connector-demo';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { clienteGrabado } from './cliente.js';
import * as odoo from './esquemas-conciliacion.js';
import { cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { crearServidor } from './servidor.js';

const PARES = [
  [
    'entrada de leer_extracto_bancario',
    odoo.EntradaLeerExtractoBancario,
    demo.EntradaLeerExtractoBancario,
  ],
  [
    'salida de leer_extracto_bancario',
    odoo.SalidaLeerExtractoBancario,
    demo.SalidaLeerExtractoBancario,
  ],
  [
    'entrada de proponer_asiento_diferencia',
    odoo.EntradaProponerAsientoDiferencia,
    demo.EntradaProponerAsientoDiferencia,
  ],
  [
    'salida de proponer_asiento_diferencia',
    odoo.SalidaProponerAsientoDiferencia,
    demo.SalidaProponerAsientoDiferencia,
  ],
] as const;

describe('contrato de conciliación compartido entre odoo y demo', () => {
  it.each(PARES)('la forma de la %s es idéntica', (_nombre, deOdoo, deDemo) => {
    expect(z.toJSONSchema(deOdoo)).toEqual(z.toJSONSchema(deDemo));
  });

  it('las dos anuncian las mismas herramientas con la misma clasificación y los mismos campos', async () => {
    const servidorOdoo = crearServidor({
      herramientas: crearHerramientas({ cliente: clienteGrabado(cargarGrabaciones()) }),
    });
    const enOdoo = new Client({ name: 'prueba', version: '0.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([servidorOdoo.connect(b), enOdoo.connect(a)]);

    const enDemo = demo.crearServidorDemo({ credencial: 'x', credencialEsperada: 'x' });
    const clienteDemo = new Client({ name: 'prueba', version: '0.0.0' });
    const [c, d] = InMemoryTransport.createLinkedPair();
    await Promise.all([enDemo.servidor.connect(d), clienteDemo.connect(c)]);

    const resumen = async (cliente: Client) =>
      (await cliente.listTools()).tools
        .filter((herramienta) =>
          [demo.HERRAMIENTA_EXTRACTO, demo.HERRAMIENTA_ASIENTO].includes(herramienta.name),
        )
        .map((herramienta) => ({
          nombre: herramienta.name,
          soloLectura: herramienta.annotations?.readOnlyHint,
          campos: Object.keys(herramienta.inputSchema.properties ?? {}).sort(),
        }));

    expect(await resumen(enOdoo)).toEqual(await resumen(clienteDemo));
    await Promise.all([enOdoo.close(), clienteDemo.close()]);
  });
});
