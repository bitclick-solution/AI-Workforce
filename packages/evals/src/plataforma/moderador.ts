/**
 * Caso dorado del moderador de sala.
 *
 * Qué se evalúa: ante una sala de Finanzas con Cobros activo, Conciliación en prueba
 * y Previsión pausada, el moderador da la palabra a quien tiene el tema en su ficha,
 * obedece a las menciones, nunca da más de dos turnos por mensaje, calla cuando
 * nadie tiene el tema, no deja hablar a un pausado y pasa las contrataciones al
 * Director de IA.
 *
 * Cómo se evalúa: por propiedades de cada decisión, no por igualdad con el texto
 * del motivo. El día que el moderador pase por un modelo, el mismo evaluador sirve.
 */
import {
  LIMITE_MAXIMO,
  moderar,
  type DecisionDelModerador,
  type ParticipanteDeSala,
} from '@aiw/rooms';

import { type ResultadoEval } from '../index.js';

export const CASO_MODERADOR = 'sala-moderador-001';

export const SALA_DE_FINANZAS: ParticipanteDeSala[] = [
  {
    puestoId: 'cobros',
    nombre: 'Cobros',
    estado: 'activo',
    temas: ['cobro', 'factura vencida', 'moroso'],
  },
  {
    puestoId: 'conciliacion',
    nombre: 'Conciliación bancaria',
    estado: 'en_prueba',
    temas: ['concili', 'banco', 'apunte', 'extracto'],
  },
  { puestoId: 'prevision', nombre: 'Previsión', estado: 'pausado', temas: ['tesoreria', 'cobro'] },
];

export interface Expectativa {
  mensaje: string;
  tipo: DecisionDelModerador['tipo'];
  /** Puestos que deben hablar, en cualquier orden. Solo para `intervenir`. */
  hablan?: string[];
}

export const EXPECTATIVAS: Expectativa[] = [
  { mensaje: '¿cómo vamos de cobros este mes?', tipo: 'intervenir', hablan: ['cobros'] },
  {
    mensaje: '¿qué apuntes del banco quedan sin conciliar?',
    tipo: 'intervenir',
    hablan: ['conciliacion'],
  },
  { mensaje: '@Conciliación ¿estás?', tipo: 'intervenir', hablan: ['conciliacion'] },
  { mensaje: '@todos ¿algo urgente?', tipo: 'intervenir', hablan: ['cobros', 'conciliacion'] },
  { mensaje: '¿cómo va la tesorería?', tipo: 'silencio' },
  { mensaje: '¿quién trae el café?', tipo: 'silencio' },
  { mensaje: 'contrata un agente de conciliación en Finanzas', tipo: 'operacion' },
  { mensaje: 'necesito alguien que reclame facturas vencidas', tipo: 'operacion' },
];

export function evaluarDecisiones(
  decisiones: { expectativa: Expectativa; decision: DecisionDelModerador }[],
  sala: readonly ParticipanteDeSala[] = SALA_DE_FINANZAS,
): ResultadoEval {
  const fallos: string[] = [];
  const pausados = new Set(sala.filter((p) => p.estado === 'pausado').map((p) => p.puestoId));
  for (const { expectativa, decision } of decisiones) {
    const donde = `«${expectativa.mensaje}»`;
    if (decision.tipo !== expectativa.tipo) {
      fallos.push(`${donde}: se esperaba ${expectativa.tipo} y fue ${decision.tipo}`);
      continue;
    }
    if (decision.motivo.trim().length === 0) fallos.push(`${donde}: decisión sin motivo`);
    if (decision.tipo !== 'intervenir') continue;
    const hablan = decision.turnos.map((t) => t.puestoId).sort();
    // El tope vale también con menciones y con «@todos» (ADR-004).
    if (hablan.length > LIMITE_MAXIMO) {
      fallos.push(`${donde}: ${hablan.length} turnos, más que el límite de ${LIMITE_MAXIMO}`);
    }
    if (hablan.some((id) => pausados.has(id))) fallos.push(`${donde}: habla un puesto pausado`);
    if (JSON.stringify(hablan) !== JSON.stringify([...(expectativa.hablan ?? [])].sort())) {
      fallos.push(`${donde}: hablan ${hablan.join(', ') || 'nadie'}`);
    }
  }
  const superados = decisiones.length - fallos.length;
  return {
    id: CASO_MODERADOR,
    superado: fallos.length === 0,
    puntuacion: decisiones.length === 0 ? 0 : Math.max(0, superados) / decisiones.length,
    diagnostico:
      fallos.length === 0
        ? `${CASO_MODERADOR}: superado`
        : `${CASO_MODERADOR}: ${fallos.join('; ')}`,
  };
}

export function ejecutarCasoModerador(): ResultadoEval {
  return evaluarDecisiones(
    EXPECTATIVAS.map((expectativa) => ({
      expectativa,
      decision: moderar(expectativa.mensaje, SALA_DE_FINANZAS),
    })),
  );
}
