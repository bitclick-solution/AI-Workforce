/**
 * Caso dorado del puesto de Cobros.
 *
 * Qué se evalúa: dada la cartera de facturas de prueba, el agente propone una nota
 * de seguimiento por cada factura vencida y **ninguna** por las que están al día.
 * El caso negativo es la mitad del caso: un agente que escribe a un cliente que no
 * debe nada no está haciendo su trabajo, está haciendo ruido, y eso cuesta más que
 * no hacer nada.
 *
 * Cómo se evalúa: por propiedades, no por igualdad con una cadena escrita a mano.
 * Una nota correcta cita el número de la factura y su importe, trata de tú porque
 * esa es la brand voice de la organización, y no amenaza ni inventa recargos. Un
 * evaluador por igualdad exacta se rompería con cualquier reescritura del prompt y
 * no diría nada útil; este sigue sirviendo cuando un proveedor de verdad sustituya
 * al guion determinista, que es justo lo que va a pasar.
 *
 * No llama a ningún modelo: el agente que se evalúa es el guion determinista de
 * `@aiw/models`, que es el que corre en la integración continua.
 */
import { redactarNotas, type FacturaParaNota, type NotaPropuesta } from '@aiw/models';

import { type ResultadoEval } from '../index.js';

/** Identificador del caso. Va en el diagnóstico y en el informe de la CI. */
export const CASO_COBROS = 'cobros-001';

export const PUESTO = 'puestos/cobros';

/**
 * Cartera del caso: tres vencidas y dos al día.
 *
 * Son las mismas cinco facturas del conector de demostración, pero escritas aquí y
 * no importadas de él a propósito: el caso dorado es el contrato de lo que se
 * espera del agente, y si cambiase solo porque alguien edita los datos del
 * conector, dejaría de ser un contrato.
 */
export const CARTERA: readonly (FacturaParaNota & { vencida: boolean })[] = [
  {
    numero: 'F-2026-0001',
    cliente: 'Talleres Mediterráneo, S.L.',
    importeEuros: 1240.5,
    diasDeRetraso: 37,
    vencida: true,
  },
  {
    numero: 'F-2026-0002',
    cliente: 'Panadería La Espiga',
    importeEuros: 318,
    diasDeRetraso: 20,
    vencida: true,
  },
  {
    numero: 'F-2026-0003',
    cliente: 'Clínica Dental Sorolla',
    importeEuros: 2860.75,
    diasDeRetraso: 11,
    vencida: true,
  },
  {
    numero: 'F-2026-0004',
    cliente: 'Gestoría Ribera',
    importeEuros: 540,
    diasDeRetraso: 0,
    vencida: false,
  },
  {
    numero: 'F-2026-0005',
    cliente: 'Hotel Marina Alta',
    importeEuros: 7420.1,
    diasDeRetraso: 0,
    vencida: false,
  },
];

export const VENCIDAS = CARTERA.filter((factura) => factura.vencida);
export const AL_DIA = CARTERA.filter((factura) => !factura.vencida);

/**
 * Palabras que la brand voice prohíbe en una nota de cobro.
 *
 * Amenazar con acciones legales o inventarse un recargo no es solo mal tono: es una
 * afirmación que la organización no ha decidido hacer, y el agente no la puede
 * hacer por ella.
 */
export const PROHIBIDAS = [
  'demanda',
  'demandar',
  'burofax',
  'recargo',
  'interés de demora',
  'intereses de demora',
  'penalización',
  'impago',
  'moroso',
  'abogado',
];

/** Cómo se formatea un importe en una nota. Dos decimales y el símbolo del euro. */
function importeEsperado(importeEuros: number): string {
  return `${importeEuros.toFixed(2)} €`;
}

export interface FalloDelCaso {
  regla: string;
  detalle: string;
}

/**
 * Evalúa las notas propuestas contra las cinco reglas del puesto.
 *
 * Devuelve puntuación entre 0 y 1: la fracción de reglas cumplidas. La
 * certificación del puesto exige 1, porque las cinco reglas son de mínimos y
 * ninguna admite «casi».
 */
export function evaluarNotas(notas: readonly NotaPropuesta[]): ResultadoEval {
  const fallos: FalloDelCaso[] = [];
  const reglas = 5;
  let cumplidas = 0;

  // 1. Una nota por factura vencida, ni una más ni una menos.
  if (notas.length === VENCIDAS.length) cumplidas += 1;
  else {
    fallos.push({
      regla: 'una nota por factura vencida',
      detalle: `se esperaban ${VENCIDAS.length} notas y llegaron ${notas.length}`,
    });
  }

  // 2. Cubre todas las vencidas.
  const cubiertas = new Set(notas.map((nota) => nota.factura));
  const sinCubrir = VENCIDAS.filter((factura) => !cubiertas.has(factura.numero));
  if (sinCubrir.length === 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'ninguna factura vencida se queda sin nota',
      detalle: `sin nota: ${sinCubrir.map((factura) => factura.numero).join(', ')}`,
    });
  }

  // 3. Ninguna nota para una factura que está al día.
  const invadidas = AL_DIA.filter((factura) => cubiertas.has(factura.numero));
  if (invadidas.length === 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'ninguna nota para una factura al día',
      detalle: `notas de más: ${invadidas.map((factura) => factura.numero).join(', ')}`,
    });
  }

  // 4. Cada nota cita su número de factura y su importe.
  const incompletas = notas.filter((nota) => {
    const factura = CARTERA.find((candidata) => candidata.numero === nota.factura);
    if (!factura) return true;
    return (
      !nota.texto.includes(factura.numero) ||
      !nota.texto.includes(importeEsperado(factura.importeEuros))
    );
  });
  if (incompletas.length === 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'cada nota cita el número y el importe de su factura',
      detalle: `sin los datos: ${incompletas.map((nota) => nota.factura).join(', ')}`,
    });
  }

  // 5. Tono de la organización: trata de tú y no amenaza.
  const conTono = notas.filter((nota) => {
    const texto = nota.texto.toLowerCase();
    const amenaza = PROHIBIDAS.some((palabra) => texto.includes(palabra));
    const tratoDeTu = /\b(te|tu|tus|nos confirmas|dínoslo|dinoslo)\b/.test(texto);
    return !amenaza && tratoDeTu;
  });
  if (conTono.length === notas.length && notas.length > 0) cumplidas += 1;
  else {
    fallos.push({
      regla: 'trata de tú y no amenaza',
      detalle: `${notas.length - conTono.length} de ${notas.length} notas fallan el tono`,
    });
  }

  const superado = cumplidas === reglas;
  return {
    id: CASO_COBROS,
    superado,
    puntuacion: cumplidas / reglas,
    diagnostico: superado
      ? `${CASO_COBROS}: superado (${reglas} de ${reglas} reglas)`
      : `${CASO_COBROS}: ${fallos.map((fallo) => `${fallo.regla} — ${fallo.detalle}`).join('; ')}`,
  };
}

/**
 * Ejecuta el caso: pone la cartera delante del agente y evalúa lo que propone.
 *
 * El agente recibe **solo** las facturas vencidas, porque eso es lo que le devuelve
 * la herramienta `listar_facturas_vencidas` del conector. Las que están al día se
 * usan para comprobar que no aparecen en ninguna nota: si el agente escribiera
 * sobre una, tendría que habérsela inventado.
 */
export function ejecutarCasoCobros(): ResultadoEval {
  const notas = redactarNotas(VENCIDAS);
  return evaluarNotas(notas);
}
