/**
 * Conformidad con los esquemas vivos: cada llamada de las herramientas de
 * conciliación se valida contra el `inputSchema` real del MCP dinámico v1.3.1.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { clienteGrabado } from './cliente.js';
import { ErrorDeConformidad, clienteConformante, type EsquemasVivos } from './conformidad.js';
import { crearHerramientasConciliacion } from './conciliacion.js';
import { cargarGrabaciones } from './grabaciones/index.js';

const FICHERO = new URL('./grabaciones/esquemas-vivos.json', import.meta.url);
const VIVOS = (JSON.parse(readFileSync(FICHERO, 'utf8')) as { herramientas: EsquemasVivos })
  .herramientas;
const HAY_ESQUEMAS_VIVOS = Object.keys(VIVOS).length > 0;

describe('el validador de conformidad', () => {
  const esquemas: EsquemasVivos = {
    chatter_post: {
      type: 'object',
      properties: { model: { type: 'string' }, record_id: { type: 'integer' } },
      required: ['model', 'record_id'],
    },
  };

  it('rechaza un argumento obligatorio con otro nombre (la deriva res_id / record_id)', async () => {
    const cliente = clienteConformante(clienteGrabado({ chatter_post: [{ carga: {} }] }), esquemas);
    await expect(
      cliente.llamar('chatter_post', { model: 'account.move', res_id: 1 }),
    ).rejects.toBeInstanceOf(ErrorDeConformidad);
  });

  it('deja pasar una llamada que cumple', async () => {
    const cliente = clienteConformante(clienteGrabado({ chatter_post: [{ carga: {} }] }), esquemas);
    await expect(
      cliente.llamar('chatter_post', { model: 'account.move', record_id: 1 }),
    ).resolves.toEqual({});
  });

  it('rechaza una herramienta sin esquema conocido', async () => {
    const cliente = clienteConformante(clienteGrabado({}), esquemas);
    await expect(cliente.llamar('unlink', {})).rejects.toThrow(/no hay esquema vivo/);
  });
});

describe.skipIf(!HAY_ESQUEMAS_VIVOS)(
  HAY_ESQUEMAS_VIVOS
    ? 'herramientas de conciliación contra los esquemas vivos del MCP v1.3.1'
    : 'herramientas de conciliación contra los esquemas vivos — SALTADO: faltan los esquemas del Probador en src/grabaciones/esquemas-vivos.json',
  () => {
    function montar() {
      const cliente = clienteConformante(clienteGrabado(cargarGrabaciones()), VIVOS);
      return crearHerramientasConciliacion({ cliente });
    }

    it('leer_extracto_bancario llama a search_records como lo anuncia el MCP', async () => {
      await expect(
        montar().leerExtractoBancario({ cuenta_id: '7', desde: '2026-09-01', limite: 5 }),
      ).resolves.toBeDefined();
    });

    it('proponer_asiento_diferencia cumple los esquemas de las cuatro llamadas', async () => {
      await expect(
        montar().proponerAsientoDiferencia({
          apunte_id: '301',
          documento_id: '46',
          importe_diferencia: -12,
          cuenta_contrapartida: '629000',
          motivo: 'Comisión bancaria descontada del cobro.',
        }),
      ).resolves.toMatchObject({ estado: 'borrador' });
    });
  },
);
