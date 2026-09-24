import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  guionCobros,
  resumirCartera,
  type FacturaParaNota,
} from './cobros.js';

const VENCIDAS: FacturaParaNota[] = [
  {
    id: 'inv-0001',
    numero: 'F-2026-0001',
    cliente: { id: 'cli-001', nombre: 'Talleres Mediterráneo, S.L.' },
    importe_pendiente: 1240.5,
    moneda: 'EUR',
    dias_vencida: 37,
  },
  {
    id: 'inv-0002',
    numero: 'F-2026-0002',
    cliente: { id: 'cli-002', nombre: 'Panadería La Espiga' },
    importe_pendiente: 318,
    moneda: 'EUR',
    dias_vencida: 20,
  },
];

/** La pregunta de la sala con el listado ya devuelto por el conector. */
function conListado(): LanguageModelV4Prompt {
  return [
    { role: 'system', content: 'Eres el agente de Cobros de Finanzas.' },
    { role: 'user', content: [{ type: 'text', text: '¿cómo vamos de cobros este mes?' }] },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'l-1', toolName: HERRAMIENTA_LISTAR, input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'l-1',
          toolName: HERRAMIENTA_LISTAR,
          output: {
            type: 'text',
            value: JSON.stringify({ facturas: VENCIDAS, total: VENCIDAS.length }),
          },
        },
      ],
    },
  ];
}

describe('guion de Cobros en la sala (solo lectura)', () => {
  it('responde con agregados y sin nombres de clientes ni números de factura', () => {
    const respuesta = guionCobros({
      prompt: conListado(),
      herramientas: [HERRAMIENTA_LISTAR],
      turno: 2,
    });
    expect(respuesta.llamadas ?? []).toEqual([]);
    expect(respuesta.texto).toContain('2 facturas vencidas');
    expect(respuesta.texto).toContain('1558.50 €');
    expect(respuesta.texto).toContain('37 días');
    expect(respuesta.texto).not.toContain('Talleres');
    expect(respuesta.texto).not.toContain('F-2026');
  });

  it('con la herramienta de escritura sigue proponiendo una nota por factura', () => {
    const respuesta = guionCobros({
      prompt: conListado(),
      herramientas: [HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA],
      turno: 2,
    });
    expect(respuesta.llamadas).toHaveLength(2);
  });

  it('cuenta las que pasan de 30 días', () => {
    expect(resumirCartera(VENCIDAS)).toContain('1 pasa de 30 días');
  });
});
