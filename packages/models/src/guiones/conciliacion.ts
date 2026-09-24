/**
 * Guion del puesto de Conciliación para el proveedor de prueba.
 *
 * Es el agente al que Cobros delega «concilia la factura F-2026-0001 con el
 * extracto bancario». Hace lo que haría uno de verdad con las herramientas que
 * tiene: busca la factura entre las vencidas, propone el asiento del cobro, lo deja
 * anotado en la factura y entrega un informe en JSON, que es el formato que pide el
 * contrato de la delegación.
 *
 * Lo que no hace es inventarse el cobro. Ningún conector le da el extracto
 * bancario, así que el informe dice `movimiento_bancario: null` y deja la propuesta
 * pendiente de cruzar. Un agente que afirmara haber visto un movimiento que no ha
 * visto sería peor que uno que no concilia: esa es la regla que su caso dorado
 * comprueba en `@aiw/evals`.
 *
 * Es un guion de demostración, no la lógica contable: las cuentas 572 y 430 son las
 * del cobro de un cliente en el Plan General Contable y bastan para enseñar el
 * flujo. La conciliación de verdad, con el extracto y las cuentas de cada empresa,
 * es otra rebanada.
 *
 * Como el de Cobros, no guarda estado: decide solo con la conversación, así que
 * reanudar un flujo de Temporal con el mismo historial da la misma respuesta.
 */
import type { ContextoDeGuion, Guion, RespuestaDeGuion } from '../proveedor-prueba.js';
import { HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA, type FacturaParaNota } from './cobros.js';
import { encargoDe, facturasDelResultado, resultadosDe } from './lectura.js';

/** Modelo del proveedor de prueba que contesta con este guion. */
export const MODELO_PRUEBA_CONCILIACION = 'deterministico-conciliacion';

export interface LineaDeAsiento {
  cuenta: string;
  concepto: string;
  debe: number;
  haber: number;
}

export interface PropuestaDeConciliacion {
  /** Número de la factura, el que se lee en el encargo y en el sistema de gestión. */
  factura: string;
  /** Identificador de la factura, el que pide el contrato de la herramienta. */
  factura_id: string;
  cliente: string;
  importe: number;
  moneda: string;
  asiento_propuesto: LineaDeAsiento[];
  /** Siempre nulo: sin extracto bancario no hay movimiento que citar. */
  movimiento_bancario: null;
  estado: 'pendiente_de_extracto';
}

export interface InformeDeConciliacion {
  resumen: string;
  propuestas: PropuestaDeConciliacion[];
  /** Números que el encargo menciona y que no están entre las facturas vencidas. */
  no_encontradas: string[];
}

/** Lo que parece un número de documento en el encargo: `F-2026-0001`, `INV/2026/00001`. */
const NUMERO_DE_DOCUMENTO = /\b[A-Z]{1,5}[-/]\d{4}[-/]\d{3,6}\b/g;

function redondear(importe: number): number {
  return Math.round(importe * 100) / 100;
}

function importeLegible(importe: number, moneda: string): string {
  return `${importe.toFixed(2)} ${moneda === 'EUR' ? '€' : moneda}`;
}

function proponer(factura: FacturaParaNota): PropuestaDeConciliacion {
  const importe = redondear(factura.importe_pendiente);
  return {
    factura: factura.numero,
    factura_id: factura.id,
    cliente: factura.cliente.nombre,
    importe,
    moneda: factura.moneda,
    asiento_propuesto: [
      { cuenta: '572', concepto: 'Bancos', debe: importe, haber: 0 },
      { cuenta: '430', concepto: 'Clientes', debe: 0, haber: importe },
    ],
    movimiento_bancario: null,
    estado: 'pendiente_de_extracto',
  };
}

/**
 * Concilia las facturas que pide el encargo.
 *
 * Si el encargo nombra facturas, concilia esas y dice cuáles no encuentra. Si no
 * nombra ninguna, concilia todas las que recibe. Es la conducta que evalúa el caso
 * dorado del puesto, y por eso vive aparte del guion.
 */
export function conciliar(
  encargo: string,
  facturas: readonly FacturaParaNota[],
): InformeDeConciliacion {
  const mencionadas = [...new Set(encargo.match(NUMERO_DE_DOCUMENTO) ?? [])];
  const pedidas =
    mencionadas.length === 0
      ? facturas
      : facturas.filter((factura) => mencionadas.includes(factura.numero));
  const noEncontradas = mencionadas.filter(
    (numero) => !facturas.some((factura) => factura.numero === numero),
  );
  const propuestas = pedidas.map(proponer);

  let resumen: string;
  if (propuestas.length === 0) {
    resumen =
      noEncontradas.length > 0
        ? `No encuentro ${noEncontradas.join(', ')} entre las facturas vencidas: no propongo ningún asiento.`
        : 'No hay facturas vencidas que conciliar.';
  } else if (propuestas.length === 1 && propuestas[0]) {
    const unica = propuestas[0];
    resumen =
      `Asiento propuesto para ${unica.factura} por ${importeLegible(unica.importe, unica.moneda)}: ` +
      '572 Bancos a 430 Clientes. Falta cruzarlo con el extracto bancario, que no tengo.';
  } else {
    const total = redondear(propuestas.reduce((suma, propuesta) => suma + propuesta.importe, 0));
    resumen =
      `Asientos propuestos para ${propuestas.length} facturas por ${importeLegible(total, 'EUR')} en total. ` +
      'Falta cruzarlos con el extracto bancario, que no tengo.';
  }

  return { resumen, propuestas, no_encontradas: noEncontradas };
}

/** Texto de la nota que deja la propuesta anotada en la factura. */
export function notaDeConciliacion(propuesta: PropuestaDeConciliacion): string {
  return (
    `Conciliación pendiente: propongo el asiento 572 Bancos a 430 Clientes por ` +
    `${importeLegible(propuesta.importe, propuesta.moneda)} para la factura ${propuesta.factura}. ` +
    'Falta cruzarlo con el extracto bancario.'
  );
}

/** El guion completo: busca, anota la propuesta y entrega el informe en JSON. */
export const guionConciliacion: Guion = (contexto: ContextoDeGuion): RespuestaDeGuion => {
  const listados = resultadosDe(contexto.prompt, HERRAMIENTA_LISTAR);
  const notasHechas = resultadosDe(contexto.prompt, HERRAMIENTA_NOTA);

  if (listados.length === 0) {
    if (!contexto.herramientas.includes(HERRAMIENTA_LISTAR)) {
      const informe: InformeDeConciliacion = {
        resumen:
          'No tengo autorizada ninguna herramienta para leer las facturas, así que no ' +
          'puedo proponer ningún asiento.',
        propuestas: [],
        no_encontradas: [],
      };
      return { texto: JSON.stringify(informe), tokens: { entrada: 700, salida: 60 } };
    }
    return {
      texto: 'Busco la factura entre las vencidas.',
      llamadas: [{ herramienta: HERRAMIENTA_LISTAR, argumentos: { dias_vencida_minimo: 1 } }],
      tokens: { entrada: 700, salida: 50 },
    };
  }

  const informe = conciliar(
    encargoDe(contexto.prompt),
    facturasDelResultado(listados[listados.length - 1] ?? ''),
  );

  if (
    notasHechas.length === 0 &&
    informe.propuestas.length > 0 &&
    contexto.herramientas.includes(HERRAMIENTA_NOTA)
  ) {
    return {
      texto: 'Dejo la propuesta de asiento anotada en la factura.',
      llamadas: informe.propuestas.map((propuesta) => ({
        herramienta: HERRAMIENTA_NOTA,
        argumentos: {
          factura_id: propuesta.factura_id,
          texto: notaDeConciliacion(propuesta),
          tipo: 'nota',
        },
      })),
      tokens: { entrada: 1300, salida: 160 },
    };
  }

  return { texto: JSON.stringify(informe), tokens: { entrada: 1500, salida: 180 } };
};
