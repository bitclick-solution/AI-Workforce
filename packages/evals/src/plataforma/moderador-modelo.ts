/**
 * Caso dorado del moderador con paso de modelo: sala de un departamento.
 *
 * Qué se evalúa: ante paráfrasis que el moderador de reglas dejaría en silencio, el
 * paso de modelo da la palabra al puesto de la sala que de verdad puede responder,
 * nunca a uno que no está en ella, calla cuando nadie puede, pasa al Director una
 * petición de organización con otras palabras, no se llama en la sala general y un
 * fallo del modelo deja el silencio de siempre.
 *
 * Contra el proveedor de prueba, con sus guiones fijos: reproducible y sin coste. No
 * sustituye a `sala-moderador-001` (reglas), que sigue como estaba.
 */
import {
  MODELO_PRUEBA_MODERADOR,
  clasificadorDePrueba,
  guionModerador,
} from '@aiw/models';
import {
  moderar,
  moderarConModelo,
  type DecisionDelModerador,
  type PuertoDeClasificacion,
} from '@aiw/rooms';

import { type ResultadoEval } from '../index.js';
import { SALA_DE_FINANZAS } from './moderador.js';

export const CASO_MODERADOR_MODELO = 'sala-moderador-modelo-001';

export interface ExpectativaConModelo {
  mensaje: string;
  ambito: 'departamento' | 'organizacion';
  tipo: DecisionDelModerador['tipo'];
  hablan?: string[];
  /** Si el paso de modelo debe haberse dado. */
  usaModelo: boolean;
}

export const EXPECTATIVAS_CON_MODELO: ExpectativaConModelo[] = [
  {
    mensaje: 'quién nos debe dinero desde hace más de dos meses',
    ambito: 'departamento',
    tipo: 'intervenir',
    hablan: ['cobros'],
    usaModelo: true,
  },
  {
    mensaje: 'hay que cuadrar los movimientos de septiembre con las facturas',
    ambito: 'departamento',
    tipo: 'intervenir',
    hablan: ['conciliacion'],
    usaModelo: true,
  },
  {
    mensaje: 'necesitamos que alguien se encargue de reclamar',
    ambito: 'departamento',
    tipo: 'operacion',
    usaModelo: true,
  },
  { mensaje: '¿quién trae el café?', ambito: 'departamento', tipo: 'silencio', usaModelo: true },
  {
    mensaje: 'quién nos debe dinero desde hace más de dos meses',
    ambito: 'organizacion',
    tipo: 'silencio',
    usaModelo: false,
  },
  { mensaje: '¿cómo vamos de cobros este mes?', ambito: 'departamento', tipo: 'intervenir', hablan: ['cobros'], usaModelo: false },
];

export interface ObtenidoConModelo {
  expectativa: ExpectativaConModelo;
  decision: DecisionDelModerador;
  usoModelo: boolean;
}

export function evaluarConModelo(obtenidos: ObtenidoConModelo[]): ResultadoEval {
  const fallos: string[] = [];
  const enLaSala = new Set(SALA_DE_FINANZAS.map((p) => p.puestoId));
  const pausados = new Set(SALA_DE_FINANZAS.filter((p) => p.estado === 'pausado').map((p) => p.puestoId));
  for (const { expectativa, decision, usoModelo } of obtenidos) {
    const donde = `«${expectativa.mensaje}» (${expectativa.ambito})`;
    if (decision.tipo !== expectativa.tipo) {
      fallos.push(`${donde}: se esperaba ${expectativa.tipo} y fue ${decision.tipo}`);
      continue;
    }
    if (usoModelo !== expectativa.usaModelo) {
      fallos.push(`${donde}: paso de modelo ${usoModelo ? 'dado' : 'no dado'} contra lo esperado`);
    }
    if (decision.tipo !== 'intervenir') continue;
    const hablan = decision.turnos.map((t) => t.puestoId);
    if (hablan.some((id) => !enLaSala.has(id))) fallos.push(`${donde}: habla un puesto que no está en la sala`);
    if (hablan.some((id) => pausados.has(id))) fallos.push(`${donde}: habla un puesto pausado`);
    if (hablan.length > 1) fallos.push(`${donde}: ${hablan.length} turnos con el límite por defecto`);
    if (JSON.stringify([...hablan].sort()) !== JSON.stringify([...(expectativa.hablan ?? [])].sort())) {
      fallos.push(`${donde}: hablan ${hablan.join(', ') || 'nadie'}`);
    }
  }
  const superados = obtenidos.length - fallos.length;
  return {
    id: CASO_MODERADOR_MODELO,
    superado: fallos.length === 0,
    puntuacion: obtenidos.length === 0 ? 0 : Math.max(0, superados) / obtenidos.length,
    diagnostico:
      fallos.length === 0
        ? `${CASO_MODERADOR_MODELO}: superado`
        : `${CASO_MODERADOR_MODELO}: ${fallos.join('; ')}`,
  };
}

export function clasificadorDelCaso(): PuertoDeClasificacion {
  return clasificadorDePrueba(MODELO_PRUEBA_MODERADOR, guionModerador) as PuertoDeClasificacion;
}

export async function ejecutarCasoModeradorConModelo(
  clasificador: PuertoDeClasificacion = clasificadorDelCaso(),
): Promise<ResultadoEval> {
  const obtenidos: ObtenidoConModelo[] = [];
  for (const expectativa of EXPECTATIVAS_CON_MODELO) {
    const resultado = await moderarConModelo(expectativa.mensaje, SALA_DE_FINANZAS, {
      ambito: expectativa.ambito,
      clasificador,
    });
    obtenidos.push({
      expectativa,
      decision: resultado.decision,
      usoModelo: resultado.pasoDeModelo.usado,
    });
  }
  return evaluarConModelo(obtenidos);
}

/** La premisa del caso: las reglas puras dejan en silencio las paráfrasis que el modelo atiende. */
export function reglasDejanEnSilencio(mensaje: string): boolean {
  return moderar(mensaje, SALA_DE_FINANZAS).tipo === 'silencio';
}
