/**
 * Supervisor de departamento v0: vigila las delegaciones entre puestos del
 * departamento y avisa a las personas en la sala cuando una no se cierra bien.
 *
 * Función pura sobre datos, como el Director de IA y el moderador de reglas: el
 * evento de la delegación entra, el mensaje de la sala (o nada) sale. No llama a
 * ningún modelo ni tiene prompt de sistema (docs/specs/supervisor-de-departamento-finanzas.md,
 * decisión 1), no llama a ninguna herramienta de un conector, no escribe en ningún
 * sistema y no cambia el estado de la tarea: lo único que hace es proponer un texto.
 * Publicarlo es de la actividad del trabajador, que lo hace una sola vez por
 * delegación.
 *
 * Qué vigila (decisión 2): solo delegaciones. Un plazo vencido, el respaldo del
 * ADR-014 aplicado o un puesto destino que no entrega y por tanto escala. No
 * publica indicadores ni umbrales ni dispara tareas por calendario (decisión 3).
 */
import { createHash } from 'node:crypto';

import { POLITICAS_RESPALDO } from '@aiw/domain';
import { sanearTexto } from '@aiw/learning';
import { z } from 'zod';

/** Hechos consumados de una delegación, nombrados como dominio.acción_en_pasado (ADR-014). */
export const TIPOS_DE_EVENTO_DE_DELEGACION = [
  'delegacion.vencida',
  'delegacion.respaldo_aplicado',
  'delegacion.cerrada',
] as const;

export type MotivoDeSupervision = 'plazo_vencido' | 'respaldo_aplicado' | 'resultado_escala';

const puestoDeEvento = z.object({ id: z.string().min(1), nombre: z.string().min(1) });

export const eventoDeDelegacion = z.object({
  tipo: z.enum(TIPOS_DE_EVENTO_DE_DELEGACION),
  delegacionId: z.string().min(1),
  encargo: z.string(),
  origen: puestoDeEvento,
  destino: puestoDeEvento,
  /** La política del contrato. Obligatoria en `vencida` y `respaldo_aplicado`. */
  politicaRespaldo: z.enum(POLITICAS_RESPALDO).optional(),
  /** En `cerrada`: si el destino entregó. Un destino que no entrega escala. */
  entregado: z.boolean().optional(),
});

export type EventoDeDelegacion = z.infer<typeof eventoDeDelegacion>;

export interface MensajeDelSupervisor {
  /**
   * Identificador del mensaje, derivado de la delegación: dos eventos de la misma
   * delegación dan el mismo identificador, y la sala no publica dos veces el mismo.
   */
  mensajeId: string;
  motivo: MotivoDeSupervision;
  /** Lo que la persona puede hacer a continuación. Siempre una propuesta: no ejecuta nada. */
  propuesta: string;
  texto: string;
}

/** Largo máximo del encargo citado: el mensaje avisa, no copia el encargo entero. */
export const LARGO_MAXIMO_DEL_ENCARGO = 200;

const ESPACIO_DE_NOMBRES = 'supervisor-de-departamento:delegacion:';

/** UUID determinista (versión 5 por forma) a partir de la delegación. */
export function idDeMensajeDelSupervisor(delegacionId: string): string {
  const hex = createHash('sha256')
    .update(ESPACIO_DE_NOMBRES + delegacionId)
    .digest('hex');
  const variante = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variante}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function citarEncargo(encargo: string): string {
  const { texto } = sanearTexto(encargo.replace(/\s+/g, ' ').trim());
  return texto.length > LARGO_MAXIMO_DEL_ENCARGO
    ? `${texto.slice(0, LARGO_MAXIMO_DEL_ENCARGO - 1)}…`
    : texto;
}

const NOMBRE_DE_POLITICA: Record<(typeof POLITICAS_RESPALDO)[number], string> = {
  seguir_sin_ello: 'seguir sin el resultado',
  aparcar: 'aparcar la tarea',
  escalar_a_persona: 'escalar a una persona',
};

function motivoDe(evento: EventoDeDelegacion): MotivoDeSupervision | null {
  switch (evento.tipo) {
    case 'delegacion.vencida':
      return 'plazo_vencido';
    case 'delegacion.respaldo_aplicado':
      return 'respaldo_aplicado';
    case 'delegacion.cerrada':
      // Una delegación que se cierra a tiempo y entregada no necesita a nadie.
      return evento.entregado === false ? 'resultado_escala' : null;
  }
}

function describirMotivo(motivo: MotivoDeSupervision, evento: EventoDeDelegacion): string {
  const respaldo = evento.politicaRespaldo
    ? ` Se aplicó el respaldo del contrato: ${NOMBRE_DE_POLITICA[evento.politicaRespaldo]}.`
    : '';
  switch (motivo) {
    case 'plazo_vencido':
      return `${evento.destino.nombre} no respondió dentro del plazo.${respaldo}`;
    case 'respaldo_aplicado':
      return `Venció el plazo y se aplicó el respaldo del contrato: ${
        evento.politicaRespaldo ? NOMBRE_DE_POLITICA[evento.politicaRespaldo] : 'sin política'
      }.`;
    case 'resultado_escala':
      return `${evento.destino.nombre} devolvió un resultado que no cumple el encargo y escala a una persona.`;
  }
}

function proponerSiguientePaso(motivo: MotivoDeSupervision, evento: EventoDeDelegacion): string {
  if (motivo === 'resultado_escala') {
    return `Revisa lo que devolvió ${evento.destino.nombre} y decide si se reasigna el encargo o se resuelve a mano.`;
  }
  switch (evento.politicaRespaldo) {
    case 'aparcar':
      return `La tarea de ${evento.origen.nombre} quedó aparcada: decide si se repite la delegación a ${evento.destino.nombre} o se retoma a mano.`;
    case 'escalar_a_persona':
      return `Decide cómo sigue la tarea de ${evento.origen.nombre}: repetir la delegación a ${evento.destino.nombre} o resolverla a mano.`;
    case 'seguir_sin_ello':
      return `${evento.origen.nombre} siguió sin el resultado: comprueba si hace falta antes de dar la tarea por cerrada.`;
    default:
      return `Revisa si ${evento.destino.nombre} sigue trabajando en el encargo de ${evento.origen.nombre} y decide cómo seguir.`;
  }
}

/**
 * Decide si un hecho de una delegación merece un aviso y lo redacta. Devuelve `null`
 * cuando no hace falta nadie: una delegación que se cierra a tiempo y entregada no
 * produce mensaje. Lanza si el evento no cumple el contrato: un evento mal formado es
 * un fallo del que lo emite, no algo que el supervisor deba adivinar.
 */
export function supervisarDelegacion(evento: unknown): MensajeDelSupervisor | null {
  const e = eventoDeDelegacion.parse(evento);
  if (e.tipo === 'delegacion.respaldo_aplicado' && e.politicaRespaldo === undefined) {
    throw new Error('Un respaldo aplicado necesita la política de respaldo que se aplicó.');
  }
  const motivo = motivoDe(e);
  if (motivo === null) return null;
  const propuesta = proponerSiguientePaso(motivo, e);
  const texto = [
    `Supervisión de delegación: ${e.origen.nombre} → ${e.destino.nombre}.`,
    `Encargo: «${citarEncargo(e.encargo)}».`,
    `Motivo: ${describirMotivo(motivo, e)}`,
    `Siguiente paso propuesto: ${propuesta}`,
  ].join('\n');
  return { mensajeId: idDeMensajeDelSupervisor(e.delegacionId), motivo, propuesta, texto };
}
