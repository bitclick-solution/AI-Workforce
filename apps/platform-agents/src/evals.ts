/**
 * Caso dorado del Director de IA: contratar desde una frase.
 *
 * Vive con el Director y no en `@aiw/evals` porque un paquete no importa una
 * aplicación. Evalúa por propiedades, como los casos de puesto: la propuesta trae
 * ficha completa, solo concede herramientas que la organización ya autorizó, lista
 * las que faltan, lleva guardrails hasta la clase crítica, coste, nivel N1, estado
 * inicial en prueba y forma de reversión. El día que el Director pase por un
 * modelo, el mismo evaluador sirve.
 */
import type { ResultadoEval } from '@aiw/evals';

import { MODELO_PRUEBA_DIRECTOR, clasificadorDePrueba, guionDirector } from '@aiw/models';
import type { PuertoDeClasificacion } from '@aiw/rooms';

import {
  proponerContratacion,
  proponerContratacionConModelo,
  type ContextoDelDirector,
  type RespuestaDelDirector,
} from './director.js';

export const CASO_DIRECTOR = 'director-contratar-001';

export const CASO_DIRECTOR_MODELO = 'director-contratar-modelo-001';

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

/** Misma contratación pedida con otras palabras que los sinónimos de la plantilla. */
export const FRASE_PARAFRASEADA_DEL_CASO =
  'queremos que alguien pase los movimientos del banco contra las facturas en Finanzas';

export function evaluarPropuesta(
  respuesta: RespuestaDelDirector,
  organizacion: ContextoDelDirector = ORGANIZACION_DEL_CASO,
  id: string = CASO_DIRECTOR,
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
    id,
    superado: fallos.length === 0,
    puntuacion: fallos.length === 0 ? 1 : 0,
    diagnostico: fallos.length === 0 ? `${id}: superado` : `${id}: ${fallos.join('; ')}`,
  };
}

export function ejecutarCasoDirector(): ResultadoEval {
  return evaluarPropuesta(proponerContratacion(FRASE_DEL_CASO, ORGANIZACION_DEL_CASO));
}

export function clasificadorDelCaso(): PuertoDeClasificacion {
  return clasificadorDePrueba(MODELO_PRUEBA_DIRECTOR, guionDirector) as PuertoDeClasificacion;
}

/**
 * Caso dorado del paso de modelo: la frase parafraseada, en la sala de un
 * departamento, produce la misma propuesta gobernada que la frase fija, y lo que no
 * encaja con el catálogo sigue siendo una aclaración.
 */
export async function ejecutarCasoDirectorConModelo(
  clasificador: PuertoDeClasificacion = clasificadorDelCaso(),
): Promise<ResultadoEval> {
  const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(
    FRASE_PARAFRASEADA_DEL_CASO,
    ORGANIZACION_DEL_CASO,
    { ambito: 'departamento', clasificador },
  );
  const resultado = evaluarPropuesta(respuesta, ORGANIZACION_DEL_CASO, CASO_DIRECTOR_MODELO);
  const fallos: string[] = resultado.superado ? [] : [resultado.diagnostico];
  if (!pasoDeModelo.usado) fallos.push('no se dio el paso de modelo');
  if (
    respuesta.tipo === 'propuesta' &&
    respuesta.propuesta.plantilla.id !== 'finanzas.conciliacion-bancaria'
  ) {
    fallos.push(`plantilla ${respuesta.propuesta.plantilla.id}`);
  }
  const soporte = await proponerContratacionConModelo(
    '¿cómo cambio de plan?',
    ORGANIZACION_DEL_CASO,
    {
      ambito: 'departamento',
      clasificador,
    },
  );
  if (soporte.respuesta.tipo !== 'aclaracion')
    fallos.push('una pregunta de producto no es una aclaración');
  return {
    id: CASO_DIRECTOR_MODELO,
    superado: fallos.length === 0,
    puntuacion: fallos.length === 0 ? 1 : 0,
    diagnostico:
      fallos.length === 0
        ? `${CASO_DIRECTOR_MODELO}: superado`
        : `${CASO_DIRECTOR_MODELO}: ${fallos.join('; ')}`,
  };
}
