/**
 * Guion del puesto de Cobros para el proveedor de prueba.
 *
 * Es el modelo de la integración continua: hace el trabajo del agente de Cobros sin
 * llamar a nadie. Lee la conversación, y según lo que ya haya pasado pide listar
 * las facturas vencidas, propone una nota por cada una o cierra con un resumen.
 *
 * `redactarNotas` está aparte a propósito: es la conducta que el caso dorado del
 * puesto evalúa. El evaluador de `@aiw/evals` la llama con la cartera de prueba y
 * comprueba propiedades —una nota por factura vencida, ninguna por una al día, el
 * número y el importe dentro del texto, el tono de la organización—, no una
 * igualdad con una cadena escrita a mano. Así el día que un proveedor de verdad
 * sustituya este guion, el mismo evaluador sirve sin tocar una línea.
 */
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

import type { ContextoDeGuion, Guion, RespuestaDeGuion } from '../proveedor-prueba.js';

export const HERRAMIENTA_LISTAR = 'listar_facturas_vencidas';
export const HERRAMIENTA_NOTA = 'crear_nota_seguimiento';

/** Factura tal como la devuelve el conector. Solo lo que la nota necesita. */
export interface FacturaParaNota {
  numero: string;
  cliente: string;
  importeEuros: number;
  diasDeRetraso: number;
}

export interface NotaPropuesta {
  factura: string;
  texto: string;
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
    factura: factura.numero,
    texto:
      `Hola, ${factura.cliente}. Te escribimos por la factura ${factura.numero}, ` +
      `de ${factura.importeEuros.toFixed(2)} €, que venció hace ${factura.diasDeRetraso} ` +
      'días. ¿Nos confirmas cuándo la vas a pagar? Si hay algún problema con ella, ' +
      'dínoslo y lo miramos.',
  }));
}

/** Resultados de herramienta que ya hay en la conversación, por nombre. */
function resultadosDe(prompt: LanguageModelV4Prompt, herramienta: string): string[] {
  const textos: string[] = [];
  for (const mensaje of prompt) {
    if (mensaje.role !== 'tool') continue;
    for (const parte of mensaje.content) {
      if (parte.type !== 'tool-result' || parte.toolName !== herramienta) continue;
      const salida = parte.output;
      if (salida.type === 'text' || salida.type === 'error-text') textos.push(salida.value);
      else if (salida.type === 'json' || salida.type === 'error-json') {
        textos.push(JSON.stringify(salida.value));
      }
      // Una ejecución denegada no es un resultado: no hay nada que leer en ella.
    }
  }
  return textos;
}

function facturasDelResultado(texto: string): FacturaParaNota[] {
  try {
    const analizado: unknown = JSON.parse(texto);
    const facturas = (analizado as { facturas?: unknown }).facturas;
    if (!Array.isArray(facturas)) return [];
    return facturas
      .filter((f): f is FacturaParaNota => typeof f === 'object' && f !== null)
      .map((f) => ({
        numero: String(f.numero),
        cliente: String(f.cliente),
        importeEuros: Number(f.importeEuros),
        diasDeRetraso: Number(f.diasDeRetraso),
      }));
  } catch {
    // Un resultado que no es JSON no es una cartera de facturas: el agente no
    // inventa notas sobre algo que no ha entendido.
    return [];
  }
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
      llamadas: [{ herramienta: HERRAMIENTA_LISTAR, argumentos: {} }],
      tokens: { entrada: 640, salida: 60 },
    };
  }

  const facturas = facturasDelResultado(listados[listados.length - 1] ?? '');

  if (notasHechas.length === 0 && facturas.length > 0) {
    if (!contexto.herramientas.includes(HERRAMIENTA_NOTA)) {
      return {
        texto:
          `Hay ${facturas.length} facturas vencidas, pero no tengo autorizada la ` +
          'herramienta para dejar la nota de seguimiento.',
        tokens: { entrada: 1200, salida: 50 },
      };
    }
    return {
      texto: `Propongo una nota de seguimiento para cada una de las ${facturas.length} facturas vencidas.`,
      llamadas: redactarNotas(facturas).map((nota) => ({
        herramienta: HERRAMIENTA_NOTA,
        argumentos: { factura: nota.factura, texto: nota.texto },
      })),
      tokens: { entrada: 1200, salida: 220 },
    };
  }

  const importe = facturas.reduce((suma, factura) => suma + factura.importeEuros, 0);
  return {
    texto:
      `Seguimiento de cobros hecho: ${facturas.length} facturas vencidas por ` +
      `${importe.toFixed(2)} € en total, con ${notasHechas.length} notas registradas.`,
    tokens: { entrada: 1400, salida: 90 },
  };
};
