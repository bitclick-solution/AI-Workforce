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
  HERRAMIENTA_ASIENTO,
  HERRAMIENTA_EXTRACTO,
  MODELO_PRUEBA_CONCILIACION,
  conciliar,
  conciliarConExtracto,
  conciliarExtracto,
  guionConciliacion,
  type ApunteDeExtracto,
  type InformeConExtracto,
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

describe('conciliar con extracto', () => {
  const apunte = (
    id: string,
    concepto: string,
    importe: number,
    documento: string | null = null,
  ): ApunteDeExtracto => ({
    id,
    cuenta_id: 'cta-001',
    fecha: '2026-09-12',
    concepto,
    importe,
    moneda: 'EUR',
    casado: documento !== null,
    documento_id: documento,
  });

  const FACTURAS: FacturaParaNota[] = [
    ...VENCIDAS,
    {
      id: 'inv-0003',
      numero: 'F-2026-0003',
      cliente: { id: 'cli-003', nombre: 'Clínica Dental Sorolla' },
      importe_pendiente: 2860.75,
      moneda: 'EUR',
      dias_vencida: 11,
    },
  ];

  it('con extracto vacío concilia como sin extracto y no inventa apuntes', () => {
    const informe = conciliarConExtracto(ENCARGO, VENCIDAS, []);
    expect(informe).toEqual(conciliar(ENCARGO, VENCIDAS));
    expect(informe).not.toHaveProperty('casados');
  });

  it('con un apunte casado cita su documento y no propone nada', () => {
    const informe = conciliarExtracto([apunte('apt-1', 'TRANSF.', 318, 'inv-0002')], FACTURAS);
    expect(informe.casados).toEqual([{ apunte_id: 'apt-1', documento_id: 'inv-0002' }]);
    expect(informe.asientos).toEqual([]);
    expect(informe.escaladas).toEqual([]);
  });

  it('con varios apuntes, cada uno acaba en una sola cosa y solo se citan los del extracto', () => {
    const extracto = [
      apunte('apt-1', 'TRANSF. F-2026-0003', 2850.75),
      apunte('apt-2', 'COMISION', -12),
      apunte('apt-3', 'TRANSF. LA ESPIGA', 318),
      apunte('apt-4', 'DEVOLUCION RECIBO LA ESPIGA', -318),
    ];
    const informe = conciliarExtracto(extracto, FACTURAS);

    expect(informe.asientos).toHaveLength(1);
    expect(informe.asientos[0]).toMatchObject({
      apunte_id: 'apt-1',
      documento_id: 'inv-0003',
      importe_diferencia: -10,
      cuenta_contrapartida: '629000',
      estado: 'borrador',
    });
    expect(informe.casados).toEqual([{ apunte_id: 'apt-3', documento_id: 'inv-0002' }]);
    expect(informe.escaladas.map((e) => [e.apunte_id, e.causa])).toEqual([
      ['apt-2', 'sin_documento'],
      ['apt-4', 'devolucion_recibo'],
    ]);
    const citados = [...informe.casados, ...informe.asientos, ...informe.escaladas].map(
      (entrada) => entrada.apunte_id,
    );
    expect(citados.sort()).toEqual(['apt-1', 'apt-2', 'apt-3', 'apt-4']);
  });

  it('un ingreso de más va a la contrapartida de ingresos', () => {
    const informe = conciliarExtracto([apunte('apt-1', 'TRANSF. F-2026-0002', 330)], FACTURAS);
    expect(informe.asientos[0]).toMatchObject({
      importe_diferencia: 12,
      cuenta_contrapartida: '759000',
    });
  });

  it('dos facturas con el mismo importe no se desempatan: se escala', () => {
    const gemelas = FACTURAS.map((f) => ({ ...f, importe_pendiente: 100 }));
    const informe = conciliarExtracto([apunte('apt-1', 'TRANSF.', 100)], gemelas);
    expect(informe.escaladas.map((e) => e.causa)).toEqual(['sin_documento']);
  });
});

describe('guion de Conciliación con extracto', () => {
  const HERRAMIENTAS_EXTRACTO = [
    HERRAMIENTA_LISTAR,
    HERRAMIENTA_NOTA,
    HERRAMIENTA_EXTRACTO,
    HERRAMIENTA_ASIENTO,
  ];
  const APUNTES = [
    {
      id: 'apt-2',
      cuenta_id: 'cta-001',
      fecha: '2026-09-12',
      concepto: 'TRANSF. F-2026-0002',
      importe: 300,
      moneda: 'EUR',
      casado: false,
      documento_id: null,
    },
    {
      id: 'apt-3',
      cuenta_id: 'cta-001',
      fecha: '2026-09-15',
      concepto: 'COMISION',
      importe: -12,
      moneda: 'EUR',
      casado: false,
      documento_id: null,
    },
  ];
  const EXTRACTO_JSON = JSON.stringify({ apuntes: APUNTES, total: APUNTES.length });
  const turno = (
    resultados: { herramienta: string; salida: string }[],
    herramientas = HERRAMIENTAS_EXTRACTO,
  ) => guionConciliacion({ prompt: conversacion(ENCARGO, resultados), herramientas, turno: 1 });
  const listado = { herramienta: HERRAMIENTA_LISTAR, salida: LISTADO };
  const extracto = { herramienta: HERRAMIENTA_EXTRACTO, salida: EXTRACTO_JSON };

  it('tras las facturas lee el extracto entero, casados incluidos', () => {
    const respuesta = turno([listado]);
    expect(respuesta.llamadas?.map((l) => l.herramienta)).toEqual([HERRAMIENTA_EXTRACTO]);
    expect(respuesta.llamadas?.[0]?.argumentos).toMatchObject({ solo_sin_casar: false });
  });

  it('crea el borrador de la diferencia con contrapartida, documento y clave de idempotencia', () => {
    const respuesta = turno([listado, extracto]);
    expect(respuesta.llamadas).toHaveLength(1);
    const [llamada] = respuesta.llamadas ?? [];
    expect(llamada?.herramienta).toBe(HERRAMIENTA_ASIENTO);
    expect(llamada?.argumentos).toMatchObject({
      apunte_id: 'apt-2',
      documento_id: 'inv-0002',
      importe_diferencia: -18,
      cuenta_contrapartida: '629000',
      clave_idempotencia: 'conciliacion-apt-2-inv-0002',
    });
  });

  it('entrega el informe con el borrador creado y la comisión escalada una vez', () => {
    const respuesta = turno([
      listado,
      extracto,
      {
        herramienta: HERRAMIENTA_ASIENTO,
        salida: JSON.stringify({
          id: 'asi-1',
          apunte_id: 'apt-2',
          estado: 'borrador',
          creado_en: '2026-10-02T10:00:00.000Z',
        }),
      },
    ]);
    expect(respuesta.llamadas ?? []).toEqual([]);
    const informe = JSON.parse(respuesta.texto ?? '') as InformeConExtracto;
    expect(informe.asientos.map((a) => [a.apunte_id, a.asiento_id])).toEqual([['apt-2', 'asi-1']]);
    expect(informe.escaladas.map((e) => [e.apunte_id, e.causa])).toEqual([
      ['apt-3', 'sin_documento'],
    ]);
  });

  it('si la herramienta falla escala el apunte una vez y no reintenta', () => {
    const respuesta = turno([
      listado,
      extracto,
      {
        herramienta: HERRAMIENTA_ASIENTO,
        salida: JSON.stringify({ error: { motivo: 'temporal' } }),
      },
    ]);
    expect(respuesta.llamadas ?? []).toEqual([]);
    const informe = JSON.parse(respuesta.texto ?? '') as InformeConExtracto;
    expect(informe.asientos).toEqual([]);
    expect(informe.escaladas.filter((e) => e.apunte_id === 'apt-2')).toEqual([
      expect.objectContaining({ causa: 'asiento_no_creado' }),
    ]);
  });

  it('sin la herramienta del asiento no escribe y lo escala', () => {
    const respuesta = turno([listado, extracto], [HERRAMIENTA_LISTAR, HERRAMIENTA_EXTRACTO]);
    expect(respuesta.llamadas ?? []).toEqual([]);
    const informe = JSON.parse(respuesta.texto ?? '') as InformeConExtracto;
    expect(informe.escaladas.map((e) => e.causa)).toContain('sin_autorizacion');
  });

  it('con el extracto vacío o con error sigue como sin extracto: dice que le falta', () => {
    for (const salida of [
      JSON.stringify({ apuntes: [], total: 0 }),
      JSON.stringify({ error: { motivo: 'temporal' } }),
    ]) {
      const respuesta = turno([listado, { herramienta: HERRAMIENTA_EXTRACTO, salida }]);
      expect(respuesta.llamadas?.map((l) => l.herramienta)).toEqual([HERRAMIENTA_NOTA]);
    }
    const final = turno([
      listado,
      { herramienta: HERRAMIENTA_EXTRACTO, salida: JSON.stringify({ apuntes: [], total: 0 }) },
      { herramienta: HERRAMIENTA_NOTA, salida: 'Simulado.' },
    ]);
    const informe = JSON.parse(final.texto ?? '') as InformeDeConciliacion;
    expect(informe.propuestas[0]?.estado).toBe('pendiente_de_extracto');
    expect(informe.propuestas[0]?.movimiento_bancario).toBeNull();
  });
});
