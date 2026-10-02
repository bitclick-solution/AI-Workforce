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
import {
  apuntesDelResultado,
  encargoDe,
  facturasDelResultado,
  resultadosDe,
  type ApunteDeExtracto,
} from './lectura.js';

export type { ApunteDeExtracto } from './lectura.js';

export const HERRAMIENTA_EXTRACTO = 'leer_extracto_bancario';
export const HERRAMIENTA_ASIENTO = 'proponer_asiento_diferencia';

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

/** Por qué un apunte se escala a una persona en vez de proponer nada sobre él. */
export type CausaDeEscalada =
  'devolucion_recibo' | 'sin_documento' | 'asiento_no_creado' | 'sin_autorizacion';

export interface AsientoDeDiferencia {
  apunte_id: string;
  documento_id: string;
  importe_diferencia: number;
  cuenta_contrapartida: string;
  motivo: string;
  estado: 'borrador';
  /** Identificador del borrador que devolvió la herramienta; nulo hasta crearlo. */
  asiento_id: string | null;
}

export interface Escalada {
  apunte_id: string;
  causa: CausaDeEscalada;
  motivo: string;
}

/** Informe cuando el conector sirve el extracto: casa, propone la diferencia y escala el resto. */
export interface InformeConExtracto {
  resumen: string;
  casados: { apunte_id: string; documento_id: string }[];
  asientos: AsientoDeDiferencia[];
  escaladas: Escalada[];
}

/** Cuentas de contrapartida de la diferencia: gasto si el banco recibió menos, ingreso si más. */
const CONTRAPARTIDA_FALTA = '629000';
const CONTRAPARTIDA_SOBRA = '759000';

/** Diferencia máxima que cuenta como importe exacto: medio céntimo. */
const TOLERANCIA = 0.005;

const DEVOLUCION_DE_RECIBO = /devoluci[oó]n|recibo devuelto|impagad/i;

/** Un apunte sin casar con el documento que se le ha encontrado, si hay uno. */
function documentoDelApunte(
  apunte: ApunteDeExtracto,
  facturas: readonly FacturaParaNota[],
): FacturaParaNota | undefined {
  const porNumero = facturas.find((factura) => apunte.concepto.includes(factura.numero));
  if (porNumero) return porNumero;
  const exactas = facturas.filter(
    (factura) => Math.abs(factura.importe_pendiente - apunte.importe) < TOLERANCIA,
  );
  // Dos facturas del mismo importe no se desempatan adivinando.
  return exactas.length === 1 ? exactas[0] : undefined;
}

/**
 * Concilia el extracto con las facturas.
 *
 * Cada apunte acaba en una sola de tres cosas: casado con su documento, con un
 * asiento de diferencia en borrador, o escalado una vez con el motivo. Un apunte
 * sin documento, o una devolución de recibo, nunca lleva asiento: sin documento no
 * hay contra qué cuadrarlo, y la devolución la decide una persona. Los apuntes del
 * informe son siempre los del extracto recibido; no se cita ninguno más.
 */
export function conciliarExtracto(
  apuntes: readonly ApunteDeExtracto[],
  facturas: readonly FacturaParaNota[],
): InformeConExtracto {
  const casados: InformeConExtracto['casados'] = [];
  const asientos: AsientoDeDiferencia[] = [];
  const escaladas: Escalada[] = [];

  for (const apunte of apuntes) {
    if (apunte.casado && apunte.documento_id !== null) {
      casados.push({ apunte_id: apunte.id, documento_id: apunte.documento_id });
      continue;
    }
    if (DEVOLUCION_DE_RECIBO.test(apunte.concepto)) {
      escaladas.push({
        apunte_id: apunte.id,
        causa: 'devolucion_recibo',
        motivo: `Devolución de recibo de ${importeLegible(apunte.importe, apunte.moneda)}: la decide una persona.`,
      });
      continue;
    }
    const factura = documentoDelApunte(apunte, facturas);
    if (!factura) {
      escaladas.push({
        apunte_id: apunte.id,
        causa: 'sin_documento',
        motivo: `No encuentro el documento del apunte de ${importeLegible(apunte.importe, apunte.moneda)}: no propongo asiento.`,
      });
      continue;
    }
    const diferencia = redondear(apunte.importe - factura.importe_pendiente);
    if (Math.abs(diferencia) < TOLERANCIA) {
      casados.push({ apunte_id: apunte.id, documento_id: factura.id });
      continue;
    }
    asientos.push({
      apunte_id: apunte.id,
      documento_id: factura.id,
      importe_diferencia: diferencia,
      cuenta_contrapartida: diferencia < 0 ? CONTRAPARTIDA_FALTA : CONTRAPARTIDA_SOBRA,
      motivo:
        `Diferencia de ${importeLegible(diferencia, apunte.moneda)} entre el apunte ${apunte.id} ` +
        `y la factura ${factura.numero}.`,
      estado: 'borrador',
      asiento_id: null,
    });
  }

  return { resumen: resumenDeExtracto(casados, asientos, escaladas), casados, asientos, escaladas };
}

function resumenDeExtracto(
  casados: readonly unknown[],
  asientos: readonly unknown[],
  escaladas: readonly unknown[],
): string {
  return (
    `${casados.length} apuntes casados, ${asientos.length} asientos de diferencia en borrador ` +
    `y ${escaladas.length} escalados a una persona. Los asientos los contabiliza una persona en el ERP.`
  );
}

/**
 * Concilia con el extracto si lo hay y, si no, como antes: propone el asiento del cobro
 * y lo deja pendiente. Un extracto vacío es una situación real y el agente sigue
 * diciendo que le falta.
 */
export function conciliarConExtracto(
  encargo: string,
  facturas: readonly FacturaParaNota[],
  apuntes: readonly ApunteDeExtracto[],
): InformeDeConciliacion | InformeConExtracto {
  return apuntes.length === 0 ? conciliar(encargo, facturas) : conciliarExtracto(apuntes, facturas);
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

  const facturas = facturasDelResultado(listados[listados.length - 1] ?? '');

  if (contexto.herramientas.includes(HERRAMIENTA_EXTRACTO)) {
    const extractos = resultadosDe(contexto.prompt, HERRAMIENTA_EXTRACTO);
    if (extractos.length === 0) {
      return {
        texto: 'Leo el extracto bancario.',
        llamadas: [
          {
            herramienta: HERRAMIENTA_EXTRACTO,
            argumentos: { solo_sin_casar: false, limite: 200 },
          },
        ],
        tokens: { entrada: 900, salida: 60 },
      };
    }
    const apuntes = apuntesDelResultado(extractos[extractos.length - 1] ?? '');
    if (apuntes.length > 0) return respuestaConExtracto(contexto, apuntes, facturas);
    // Extracto vacío o ilegible: se sigue como sin extracto y el informe lo dice.
  }

  const informe = conciliar(encargoDe(contexto.prompt), facturas);

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

/**
 * Turno del guion con el extracto ya leído: crea los borradores de diferencia, una
 * sola vez, y entrega el informe. Un borrador que la herramienta no devuelve se
 * escala una vez con su causa; no se reintenta.
 */
function respuestaConExtracto(
  contexto: ContextoDeGuion,
  apuntes: readonly ApunteDeExtracto[],
  facturas: readonly FacturaParaNota[],
): RespuestaDeGuion {
  const informe = conciliarExtracto(apuntes, facturas);
  const resultados = resultadosDe(contexto.prompt, HERRAMIENTA_ASIENTO);
  const puedeEscribir = contexto.herramientas.includes(HERRAMIENTA_ASIENTO);

  if (informe.asientos.length > 0 && puedeEscribir && resultados.length === 0) {
    return {
      texto: 'Dejo en borrador el asiento de las diferencias.',
      llamadas: informe.asientos.map((asiento) => ({
        herramienta: HERRAMIENTA_ASIENTO,
        argumentos: {
          apunte_id: asiento.apunte_id,
          documento_id: asiento.documento_id,
          importe_diferencia: asiento.importe_diferencia,
          cuenta_contrapartida: asiento.cuenta_contrapartida,
          motivo: asiento.motivo,
          clave_idempotencia: `conciliacion-${asiento.apunte_id}-${asiento.documento_id}`,
        },
      })),
      tokens: { entrada: 1300, salida: 200 },
    };
  }

  const creados: AsientoDeDiferencia[] = [];
  const escaladas = [...informe.escaladas];
  informe.asientos.forEach((asiento, indice) => {
    const id = borradorCreado(resultados[indice]);
    if (id !== null) {
      creados.push({ ...asiento, asiento_id: id });
      return;
    }
    escaladas.push({
      apunte_id: asiento.apunte_id,
      causa: puedeEscribir ? 'asiento_no_creado' : 'sin_autorizacion',
      motivo: puedeEscribir
        ? `No he podido crear el borrador de ${importeLegible(asiento.importe_diferencia, 'EUR')}: lo revisa una persona.`
        : 'No tengo autorizada la herramienta del asiento de diferencia: lo propone una persona.',
    });
  });

  const final: InformeConExtracto = {
    ...informe,
    asientos: creados,
    escaladas,
    resumen: resumenDeExtracto(informe.casados, creados, escaladas),
  };
  return { texto: JSON.stringify(final), tokens: { entrada: 1600, salida: 260 } };
}

/** Identificador del borrador si el resultado es el del contrato; nulo en cualquier otro caso. */
function borradorCreado(texto: string | undefined): string | null {
  if (texto === undefined) return null;
  try {
    const salida = JSON.parse(texto) as { id?: unknown; estado?: unknown };
    return salida.estado === 'borrador' && typeof salida.id === 'string' ? salida.id : null;
  } catch {
    return null;
  }
}
