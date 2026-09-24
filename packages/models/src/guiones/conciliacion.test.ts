import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import { describe, expect, it } from 'vitest';

import { MODELO_PRUEBA } from '../proveedor-prueba.js';
import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  guionCobros,
  type FacturaParaNota,
} from './cobros.js';
import {
  MODELO_PRUEBA_CONCILIACION,
  conciliar,
  guionConciliacion,
  type InformeDeConciliacion,
} from './conciliacion.js';
import { GuionNoRegistrado, enrutadorDeGuiones, guionDelModelo } from './index.js';

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

const ENCARGO = 'Concilia la factura F-2026-0001 con el extracto bancario.';
const HERRAMIENTAS = [HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA];

/** Conversación con el encargo y los resultados de herramienta que ya hay. */
function conversacion(
  encargo: string,
  resultados: { herramienta: string; salida: string }[] = [],
): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = [
    { role: 'system', content: 'Eres el agente de Conciliación de Finanzas.' },
    { role: 'user', content: [{ type: 'text', text: encargo }] },
  ];
  resultados.forEach((resultado, indice) => {
    const toolCallId = `llamada-${indice + 1}`;
    prompt.push({
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId, toolName: resultado.herramienta, input: {} }],
    });
    prompt.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: resultado.herramienta,
          output: { type: 'text', value: resultado.salida },
        },
      ],
    });
  });
  return prompt;
}

const LISTADO = JSON.stringify({ facturas: VENCIDAS, total: VENCIDAS.length });

describe('conciliar', () => {
  it('propone el asiento de la factura que pide el encargo, y solo de esa', () => {
    const informe = conciliar(ENCARGO, VENCIDAS);

    expect(informe.propuestas).toHaveLength(1);
    const [propuesta] = informe.propuestas;
    expect(propuesta?.factura).toBe('F-2026-0001');
    expect(propuesta?.factura_id).toBe('inv-0001');
    expect(informe.no_encontradas).toEqual([]);
    expect(informe.resumen).toContain('F-2026-0001');
    expect(informe.resumen).toContain('1240.50 €');
  });

  it('el asiento cuadra por el importe de la factura', () => {
    const [propuesta] = conciliar(ENCARGO, VENCIDAS).propuestas;
    const lineas = propuesta?.asiento_propuesto ?? [];
    const debe = lineas.reduce((suma, linea) => suma + linea.debe, 0);
    const haber = lineas.reduce((suma, linea) => suma + linea.haber, 0);

    expect(debe).toBeCloseTo(1240.5, 2);
    expect(haber).toBeCloseTo(1240.5, 2);
  });

  it('no se inventa el cobro: sin extracto, el movimiento queda nulo y pendiente', () => {
    const [propuesta] = conciliar(ENCARGO, VENCIDAS).propuestas;
    expect(propuesta?.movimiento_bancario).toBeNull();
    expect(propuesta?.estado).toBe('pendiente_de_extracto');
  });

  it('dice qué factura del encargo no encuentra y no propone nada por ella', () => {
    const informe = conciliar('Concilia la factura F-2026-0099.', VENCIDAS);
    expect(informe.propuestas).toEqual([]);
    expect(informe.no_encontradas).toEqual(['F-2026-0099']);
    expect(informe.resumen).toContain('F-2026-0099');
  });

  it('sin ninguna factura en el encargo, concilia todas las que recibe', () => {
    const informe = conciliar('Concilia las facturas vencidas de hoy.', VENCIDAS);
    expect(informe.propuestas.map((propuesta) => propuesta.factura)).toEqual([
      'F-2026-0001',
      'F-2026-0002',
    ]);
  });
});

describe('guion de Conciliación', () => {
  it('primero busca la factura entre las vencidas', () => {
    const respuesta = guionConciliacion({
      prompt: conversacion(ENCARGO),
      herramientas: HERRAMIENTAS,
      turno: 1,
    });
    expect(respuesta.llamadas?.map((llamada) => llamada.herramienta)).toEqual([HERRAMIENTA_LISTAR]);
  });

  it('después deja la propuesta anotada en la factura pedida, y en ninguna otra', () => {
    const respuesta = guionConciliacion({
      prompt: conversacion(ENCARGO, [{ herramienta: HERRAMIENTA_LISTAR, salida: LISTADO }]),
      herramientas: HERRAMIENTAS,
      turno: 1,
    });

    expect(respuesta.llamadas).toHaveLength(1);
    const [nota] = respuesta.llamadas ?? [];
    expect(nota?.herramienta).toBe(HERRAMIENTA_NOTA);
    expect(nota?.argumentos['factura_id']).toBe('inv-0001');
    expect(String(nota?.argumentos['texto'])).toContain('F-2026-0001');
    expect(String(nota?.argumentos['texto'])).toContain('1240.50 €');
  });

  it('al final entrega el informe en JSON, que es el formato del contrato', () => {
    const respuesta = guionConciliacion({
      prompt: conversacion(ENCARGO, [
        { herramienta: HERRAMIENTA_LISTAR, salida: LISTADO },
        { herramienta: HERRAMIENTA_NOTA, salida: 'Simulado, no se ha escrito nada.' },
      ]),
      herramientas: HERRAMIENTAS,
      turno: 1,
    });

    expect(respuesta.llamadas ?? []).toEqual([]);
    const informe = JSON.parse(respuesta.texto ?? '') as InformeDeConciliacion;
    expect(informe.propuestas.map((propuesta) => propuesta.factura)).toEqual(['F-2026-0001']);
    expect(informe.propuestas[0]?.asiento_propuesto.length).toBeGreaterThan(0);
  });

  it('sin herramienta para leer las facturas, lo dice en el informe y no propone nada', () => {
    const respuesta = guionConciliacion({
      prompt: conversacion(ENCARGO),
      herramientas: [],
      turno: 1,
    });
    const informe = JSON.parse(respuesta.texto ?? '') as InformeDeConciliacion;
    expect(informe.propuestas).toEqual([]);
    expect(informe.resumen).toContain('No tengo autorizada');
  });
});

describe('catálogo de guiones del proveedor de prueba', () => {
  it('cada modelo contesta con el guion de su puesto', () => {
    expect(guionDelModelo(MODELO_PRUEBA)).toBe(guionCobros);
    expect(guionDelModelo(MODELO_PRUEBA_CONCILIACION)).toBe(guionConciliacion);
  });

  it('un modelo sin guion falla en vez de contestar con el de otro puesto', () => {
    expect(() => guionDelModelo('otro-modelo')).toThrow(GuionNoRegistrado);
  });

  it('el enrutador resuelve el modelo que dice el enrutado del puesto', () => {
    const resuelto = enrutadorDeGuiones().resolver({
      proveedor: 'prueba',
      modelo: MODELO_PRUEBA_CONCILIACION,
    });
    expect(resuelto.modeloId).toBe(MODELO_PRUEBA_CONCILIACION);
    expect(resuelto.modelo.modelId).toBe(MODELO_PRUEBA_CONCILIACION);
  });
});
