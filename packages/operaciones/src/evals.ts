/**
 * Caso dorado del Director de IA: contratar desde una frase.
 *
 * Vive con el Director para que el caso y el código que evalúa cambien juntos.
 * Evalúa por propiedades, como los casos de puesto: la propuesta trae
 * ficha completa, solo concede herramientas que la organización ya autorizó, lista
 * las que faltan, lleva guardrails hasta la clase crítica, coste, nivel N1, estado
 * inicial en prueba y forma de reversión. El día que el Director pase por un
 * modelo, el mismo evaluador sirve.
 */
import type { ResultadoEval } from '@aiw/evals';

import {
  proponerContratacion,
  type ContextoDelDirector,
  type RespuestaDelDirector,
} from './director.js';

export const CASO_DIRECTOR = 'director-contratar-001';

export const FRASE_DEL_CASO = 'contrata un agente de conciliación en Finanzas';

export const ORGANIZACION_DEL_CASO: ContextoDelDirector = {
  departamentos: [{ id: 'finanzas', nombre: 'Finanzas', estado: 'activo' }],
  puestos: [{ id: 'cobros', nombre: 'Cobros', departamentoId: 'finanzas', estado: 'activo' }],
  conectores: [
    {
      id: 'erp',
      nombre: 'demo-cobros',
      herramientasAutorizadas: ['listar_facturas_vencidas', 'crear_nota_seguimiento'],
    },
  ],
};

export function evaluarPropuesta(
  respuesta: RespuestaDelDirector,
  organizacion: ContextoDelDirector = ORGANIZACION_DEL_CASO,
): ResultadoEval {
  const fallos: string[] = [];
  if (respuesta.tipo !== 'propuesta') {
    fallos.push(`no hay propuesta: ${respuesta.mensaje}`);
  } else {
    const { propuesta } = respuesta;
    const ficha = propuesta.puesto.ficha;
    if (!ficha.mision || ficha.tareas.length === 0 || ficha.limites.length === 0 || !ficha.escala) {
      fallos.push('ficha incompleta');
    }
    const autorizadas = new Set(organizacion.conectores.flatMap((c) => c.herramientasAutorizadas));
    const concedidas = propuesta.herramientas.disponibles.map((h) => h.nombre);
    if (concedidas.length === 0) fallos.push('ninguna herramienta disponible');
    if (concedidas.some((h) => !autorizadas.has(h))) {
      fallos.push('concede una herramienta que la organización no autorizó');
    }
    if (propuesta.herramientas.porConectar.some((h) => autorizadas.has(h.nombre))) {
      fallos.push('da por conectar una herramienta que ya está');
    }
    const clases = new Set(propuesta.guardrails.map((g) => g.clase));
    if (!clases.has('bajo') || !clases.has('critico'))
      fallos.push('guardrails sin clase baja o crítica');
    if (!(propuesta.coste.eurosMesCliente > 0 && propuesta.coste.tareasMes > 0)) {
      fallos.push('sin coste');
    }
    if (propuesta.nivelExigido !== 'n1')
      fallos.push(`nivel ${propuesta.nivelExigido} en vez de n1`);
    if (propuesta.puesto.estadoInicial !== 'en_prueba') fallos.push('no arranca en prueba');
    if (propuesta.reversion.operacion !== 'dar_de_baja') fallos.push('sin forma de reversión');
    if (organizacion.departamentos.every((d) => d.id !== propuesta.departamento.id)) {
      fallos.push('departamento inexistente');
    }
  }
  return {
    id: CASO_DIRECTOR,
    superado: fallos.length === 0,
    puntuacion: fallos.length === 0 ? 1 : 0,
    diagnostico:
      fallos.length === 0 ? `${CASO_DIRECTOR}: superado` : `${CASO_DIRECTOR}: ${fallos.join('; ')}`,
  };
}

export function ejecutarCasoDirector(): ResultadoEval {
  return evaluarPropuesta(proponerContratacion(FRASE_DEL_CASO, ORGANIZACION_DEL_CASO));
}
