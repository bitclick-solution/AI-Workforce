import { describe, expect, it } from 'vitest';

import { leerRespuesta } from './cliente.js';

describe('leerRespuesta', () => {
  it('una herramienta de Markdown solo trae texto: structuredContent.result lo repite', () => {
    const texto = '**Factura 1-000123**\n- Total: 1.21 €';
    expect(
      leerRespuesta(
        {
          content: [{ type: 'text', text: texto }],
          structuredContent: { result: texto },
          isError: false,
        },
        'get_factura',
      ),
    ).toEqual({ texto });
  });

  it('un borrador trae JSON estructurado', () => {
    expect(
      leerRespuesta(
        {
          content: [{ type: 'text', text: '{"draft_id":"B1"}' }],
          structuredContent: { draft_id: 'B1' },
        },
        'draft_modificar_cliente',
      ).estructurado,
    ).toEqual({ draft_id: 'B1' });
  });

  it('JSON solo en el texto también vale', () => {
    expect(
      leerRespuesta({ content: [{ type: 'text', text: '{"draft_id":"B1"}' }] }, 'x').estructurado,
    ).toEqual({ draft_id: 'B1' });
  });

  it('isError true sale con el motivo del texto y recortado', () => {
    try {
      leerRespuesta(
        { isError: true, content: [{ type: 'text', text: '401 Unauthorized\ntraza interna' }] },
        'get_factura',
      );
      expect.unreachable('debía fallar');
    } catch (error) {
      expect(error).toMatchObject({ motivo: 'no_autorizado' });
      expect((error as Error).message).not.toContain('traza interna');
    }
  });

  it('isError false con «no encontrado» NO es un error del protocolo: lo decide la herramienta', () => {
    expect(
      leerRespuesta(
        {
          isError: false,
          content: [{ type: 'text', text: 'No se ha encontrado la factura 1-999999.' }],
        },
        'get_factura',
      ).texto,
    ).toBe('No se ha encontrado la factura 1-999999.');
  });
});
