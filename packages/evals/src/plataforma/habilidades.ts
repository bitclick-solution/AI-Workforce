/**
 * Caso dorado del mecanismo de habilidades en el bucle: `habilidad-carga-001`.
 *
 * Qué se evalúa: con dos habilidades congeladas y un encargo que encaja en los
 * casos que aplican de una sola, el agente pide esa habilidad por su nombre y no
 * la otra. El «agente» que se evalúa aquí es el guion determinista del proveedor
 * de prueba, igual que en los casos de Cobros y Conciliación: el mismo criterio
 * corre contra el proveedor real en el trabajo semanal
 * (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md, «Casos de prueba y
 * de eval»).
 *
 * Las dos habilidades de este fichero son fijas de prueba, no contenido de
 * Finanzas: el catálogo de España para Cobros, Conciliación y Previsión es una
 * rebanada de contenido aparte (decisión 1 de la especificación), y sus propios
 * casos dorados —tres por habilidad, incluido el de escalar cuando la persona
 * pide asesoramiento— llegan con ella.
 */
import type { ResultadoEval } from '../index.js';

export const CASO_HABILIDAD_CARGA = 'habilidad-carga-001';

export interface HabilidadDePrueba {
  nombre: string;
  casosQueAplican: string[];
  pasos: string[];
  comprobaciones: string[];
}

/** Índice de dos habilidades de prueba, del mismo tamaño que vería el agente. */
export const HABILIDADES_DE_PRUEBA: readonly HabilidadDePrueba[] = [
  {
    nombre: 'prueba.antiguedad-de-cobros',
    casosQueAplican: ['agrupar facturas vencidas por tramo de antigüedad'],
    pasos: ['Agrupa las facturas vencidas en tramos de 0-30, 31-60, 61-90 y más de 90 días.'],
    comprobaciones: ['La suma de los tramos coincide con el total de vencido del ERP.'],
  },
  {
    nombre: 'prueba.leer-norma-43',
    casosQueAplican: ['leer un extracto bancario en formato Norma 43'],
    pasos: ['Lee las cabeceras y los movimientos del extracto en formato Norma 43.'],
    comprobaciones: ['El saldo inicial más los movimientos da el saldo final declarado.'],
  },
] as const;

/**
 * El guion del proveedor de prueba: decide qué habilidad pedir mirando si alguno
 * de sus casos que aplican aparece, por palabra, en el encargo. Sin coincidencia,
 * no pide ninguna: una habilidad que no aplica no se carga (criterio 1).
 */
export function elegirHabilidad(
  encargo: string,
  indice: readonly Pick<HabilidadDePrueba, 'nombre' | 'casosQueAplican'>[],
): string | null {
  const normalizado = encargo.toLowerCase();
  for (const habilidad of indice) {
    const encaja = habilidad.casosQueAplican.some((caso) =>
      caso
        .toLowerCase()
        .split(/\s+/)
        .filter((palabra) => palabra.length > 4)
        .some((palabra) => normalizado.includes(palabra)),
    );
    if (encaja) return habilidad.nombre;
  }
  return null;
}

export interface EleccionEvaluable {
  encargo: string;
  esperada: string | null;
  obtenida: string | null;
}

/** Evalúa que la elección coincide con la habilidad que de verdad aplica al encargo. */
export function evaluarEleccionDeHabilidad(eleccion: EleccionEvaluable): ResultadoEval {
  const superado = eleccion.obtenida === eleccion.esperada;
  return {
    id: CASO_HABILIDAD_CARGA,
    superado,
    puntuacion: superado ? 1 : 0,
    diagnostico: superado
      ? `${CASO_HABILIDAD_CARGA}: superado`
      : `${CASO_HABILIDAD_CARGA}: para «${eleccion.encargo}» se esperaba ` +
        `«${eleccion.esperada ?? 'ninguna'}» y se pidió «${eleccion.obtenida ?? 'ninguna'}»`,
  };
}

/** El caso dorado del criterio: un encargo de antigüedad de cobros pide esa habilidad y no otra. */
export function ejecutarCasoCargaDeHabilidad(): ResultadoEval {
  const encargo = 'Agrupa las facturas vencidas por tramo de antigüedad para el comité de hoy.';
  const obtenida = elegirHabilidad(encargo, HABILIDADES_DE_PRUEBA);
  return evaluarEleccionDeHabilidad({
    encargo,
    esperada: 'prueba.antiguedad-de-cobros',
    obtenida,
  });
}
