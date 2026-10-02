/**
 * Prueba de conformidad: cada llamada del conector al MCP dinámico se valida
 * contra el esquema de entrada real de esa herramienta en la v1.3.1
 * (`esquemas-mcp-dinamico.ts`), no contra lo que la grabación de prueba espera
 * encontrar. `clienteGrabado` solo comprueba que la llamada case con la
 * grabación: una grabación con la forma supuesta de siempre pasaría igual. Es
 * la red de seguridad que pide el encargo de dirección del 2-10 contra una
 * cuarta deriva de forma supuesta, después de `records`, `result` y `res_id`.
 */
import { describe, expect, it } from 'vitest';

import { clienteGrabado } from './cliente.js';
import { ESQUEMAS_MCP_DINAMICO } from './esquemas-mcp-dinamico.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';

function montar() {
  const cliente = clienteGrabado(cargarGrabaciones());
  const herramientas = crearHerramientas({ cliente, ahora: () => DIA_DE_LA_GRABACION });
  return { herramientas, cliente };
}

describe('conformidad con el esquema de entrada real del MCP dinámico (v1.3.1)', () => {
  it('listar_facturas_vencidas llama a search_records con argumentos válidos', async () => {
    const { herramientas, cliente } = montar();
    await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 2 });
    expect(cliente.llamadas).toHaveLength(1);
    expect(() =>
      ESQUEMAS_MCP_DINAMICO.search_records.parse(cliente.llamadas[0]?.argumentos),
    ).not.toThrow();
  });

  it('crear_nota_seguimiento de tipo «nota» llama a chatter_post con argumentos válidos', async () => {
    const { herramientas, cliente } = montar();
    await herramientas.crearNotaSeguimiento({ factura_id: 42, texto: 'Nota de conformidad.' });
    expect(cliente.llamadas).toHaveLength(1);
    expect(cliente.llamadas[0]?.herramienta).toBe('chatter_post');
    expect(() =>
      ESQUEMAS_MCP_DINAMICO.chatter_post.parse(cliente.llamadas[0]?.argumentos),
    ).not.toThrow();
  });

  it('crear_nota_seguimiento de tipo «actividad» llama a las tres herramientas de escritura con argumentos válidos', async () => {
    const { herramientas, cliente } = montar();
    await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Segundo aviso de conformidad.',
      tipo: 'actividad',
      fecha_limite: '2026-10-01',
    });
    expect(cliente.llamadas.map((llamada) => llamada.herramienta)).toEqual([
      'preview_write',
      'validate_write',
      'execute_approved_write',
    ]);
    for (const llamada of cliente.llamadas) {
      const esquema =
        ESQUEMAS_MCP_DINAMICO[llamada.herramienta as keyof typeof ESQUEMAS_MCP_DINAMICO];
      expect(() => esquema.parse(llamada.argumentos)).not.toThrow();
    }
  });
});
