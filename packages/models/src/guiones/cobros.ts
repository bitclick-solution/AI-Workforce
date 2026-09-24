/**
 * Guion del puesto de Cobros para el proveedor de prueba.
 *
 * Es el modelo de la integración continua: hace el trabajo del agente de Cobros sin
 * llamar a nadie. Lee la conversación, y según lo que ya haya pasado pide listar
 * las facturas vencidas, propone una nota por cada una o cierra con un resumen.
 *
 * Habla el contrato de herramientas de los conectores de cobros —el de Odoo y el de
 * demostración—, así que los nombres de los campos son los del contrato:
 * `factura_id`, `importe_pendiente`, `dias_vencida`. Escribir aquí otros nombres
 * sería inventarse una traducción que el conector no hace.
 *
 * `redactarNotas` está aparte a propósito: es la conducta que el caso dorado del
 * puesto evalúa. El evaluador de `@aiw/evals` la llama con la cartera de prueba y
 * comprueba propiedades —una nota por factura vencida, ninguna por una al día, el
 * número y el importe dentro del texto, el tono de la organización—, no una
 * igualdad con una cadena escrita a mano. Así el día que un proveedor de verdad
 * sustituya este guion, el mismo evaluador sirve sin tocar una línea.
 */
import type { ContextoDeGuion, Guion, RespuestaDeGuion } from '../proveedor-prueba.js';
import { facturasDelResultado, resultadosDe } from './lectura.js';

export const HERRAMIENTA_LISTAR = 'listar_facturas_vencidas';
export const HERRAMIENTA_NOTA = 'crear_nota_seguimiento';

/** Factura tal como la devuelve el contrato. Solo lo que la nota necesita. */
export interface FacturaParaNota {
  id: string;
  numero: string;
  cliente: { id: string; nombre: string };
  importe_pendiente: number;
  moneda: string;
  dias_vencida: number;
}

export interface NotaPropuesta {
  /** Identificador de la factura, que es lo que pide el contrato de la herramienta. */
  factura_id: string;
  /** Número de la factura. No va a la herramienta; sirve para leer y para evaluar. */
  numero: string;
  texto: string;
}

/** Importe con dos decimales y su moneda, como se escribe en una nota. */
function importeLegible(factura: FacturaParaNota): string {
  const simbolo = factura.moneda === 'EUR' ? '€' : factura.moneda;
  return `${factura.importe_pendiente.toFixed(2)} ${simbolo}`;
}

/**
 * Redacta la nota de seguimiento de cada factura.
 *
 * Una nota por factura, con el número y el importe dentro, porque una nota de cobro
 * que no dice qué se debe obliga a quien la lee a buscarlo. Trato de tú, sin
 * amenazas y sin recargos: eso es la brand voice de la organización y es lo que el
 * evaluador comprueba.
 */
export function redactarNotas(facturas: readonly FacturaParaNota[]): NotaPropuesta[] {
  return facturas.map((factura) => ({
    factura_id: factura.id,
    numero: factura.numero,
    texto:
      `Hola, ${factura.cliente.nombre}. Te escribimos por la factura ${factura.numero}, ` +
      `de ${importeLegible(factura)}, que venció hace ${factura.dias_vencida} días. ` +
      '¿Nos confirmas cuándo la vas a pagar? Si hay algún problema con ella, dínoslo ' +
      'y lo miramos.',
  }));
}

/**
 * Resumen agregado de la cartera vencida para la sala: cuántas, cuánto y la más
 * antigua. Ni un nombre de cliente ni un número de factura.
 */
export function resumirCartera(facturas: readonly FacturaParaNota[]): string {
  const importe = facturas.reduce((suma, factura) => suma + factura.importe_pendiente, 0);
  const antigua = Math.max(...facturas.map((factura) => factura.dias_vencida));
  const masDe30 = facturas.filter((factura) => factura.dias_vencida > 30).length;
  return (
    `Este mes hay ${facturas.length} facturas vencidas por ${importe.toFixed(2)} € en total; ` +
    `la más antigua lleva ${antigua} días y ${masDe30} pasan de 30 días. ` +
    'Si quieres, preparo una nota de seguimiento para cada una y te la paso para aprobar.'
  );
}

/**
 * El guion completo.
 *
 * No lleva estado propio: decide solo con la conversación. Por eso reanudar un
 * flujo de Temporal y volver a llamar al modelo con el mismo historial produce la
 * misma respuesta, que es lo que hace comprobable la durabilidad.
 */
export const guionCobros: Guion = (contexto: ContextoDeGuion): RespuestaDeGuion => {
  const listados = resultadosDe(contexto.prompt, HERRAMIENTA_LISTAR);
  const notasHechas = resultadosDe(contexto.prompt, HERRAMIENTA_NOTA);

  if (listados.length === 0) {
    if (!contexto.herramientas.includes(HERRAMIENTA_LISTAR)) {
      return {
        texto:
          'No tengo autorizada ninguna herramienta para consultar las facturas ' +
          'vencidas, así que no puedo hacer el seguimiento de cobros.',
        tokens: { entrada: 640, salida: 40 },
      };
    }
    return {
      texto: 'Voy a ver qué facturas están vencidas.',
      llamadas: [{ herramienta: HERRAMIENTA_LISTAR, argumentos: { dias_vencida_minimo: 1 } }],
      tokens: { entrada: 640, salida: 60 },
    };
  }

  const facturas = facturasDelResultado(listados[listados.length - 1] ?? '');

  if (notasHechas.length === 0 && facturas.length > 0) {
    if (!contexto.herramientas.includes(HERRAMIENTA_NOTA)) {
      // Sin la herramienta de escritura —una intervención en la sala es de solo
      // lectura— responde con agregados: número, importe y antigüedad, sin nombres
      // de clientes, que es lo que la sala general puede ver (plan v8, _Cómo funciona
      // la sala_, privacidad).
      return { texto: resumirCartera(facturas), tokens: { entrada: 1200, salida: 70 } };
    }
    return {
      texto: `Propongo una nota de seguimiento para cada una de las ${facturas.length} facturas vencidas.`,
      llamadas: redactarNotas(facturas).map((nota) => ({
        herramienta: HERRAMIENTA_NOTA,
        argumentos: { factura_id: nota.factura_id, texto: nota.texto, tipo: 'nota' },
      })),
      tokens: { entrada: 1200, salida: 220 },
    };
  }

  const importe = facturas.reduce((suma, factura) => suma + factura.importe_pendiente, 0);
  return {
    texto:
      `Seguimiento de cobros hecho: ${facturas.length} facturas vencidas por ` +
      `${importe.toFixed(2)} € en total, con ${notasHechas.length} notas registradas.`,
    tokens: { entrada: 1400, salida: 90 },
  };
};
