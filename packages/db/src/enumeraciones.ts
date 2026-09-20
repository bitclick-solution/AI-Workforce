/**
 * Enumeraciones del modelo como tipos `enum` de PostgreSQL.
 *
 * Van en columnas porque se filtran y se ordenan; lo que varía por cliente vive en
 * `jsonb` validado con Zod. Los valores no se escriben aquí: salen de `@aiw/domain`,
 * que es donde vive el vocabulario del negocio, así que el tipo de la base y el
 * esquema Zod que lo valida no pueden separarse.
 *
 * El plan de la organización no está aquí a propósito: es una columna `text`
 * validada por el esquema Zod de `@aiw/domain`, porque el ADR-011 lo marca como
 * hipótesis que se revisa al cierre de la fase 1 y cambiarla no puede costar una
 * migración de tipo.
 */
import {
  AMBITOS,
  CANALES_NOTIFICACION,
  CLASES_RIESGO,
  ESTADOS_CONECTOR,
  ESTADOS_DEPARTAMENTO,
  ESTADOS_EVENTO_SALIDA,
  ESTADOS_LECCION,
  ESTADOS_NOTIFICACION,
  ESTADOS_ORGANIZACION,
  ESTADOS_PROPUESTA,
  ESTADOS_PUESTO,
  ESTADOS_TAREA,
  NIVELES,
  ORIGENES_TAREA,
  RESULTADOS_ACCION,
  ROLES_PARTICIPANTE,
  SENTIDOS_DECISION,
  TIPOS_ACTOR,
  TIPOS_CONECTOR,
  TIPOS_DISPARADOR,
  TIPOS_OPERACION,
  TIPOS_SENAL,
} from '@aiw/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

export const estadoOrganizacion = pgEnum('estado_organizacion', ESTADOS_ORGANIZACION);

export const estadoDepartamento = pgEnum('estado_departamento', ESTADOS_DEPARTAMENTO);

export const estadoPuesto = pgEnum('estado_puesto', ESTADOS_PUESTO);

export const claseRiesgo = pgEnum('clase_riesgo', CLASES_RIESGO);

/** Niveles de autonomía por clase de acción (ADR-003). N0 propone, N3 actúa solo. */
export const nivelAutonomia = pgEnum('nivel_autonomia', NIVELES);

export const origenTarea = pgEnum('origen_tarea', ORIGENES_TAREA);

/** Proyección del estado que dicta el historial de Temporal. Se puede reconstruir. */
export const estadoTarea = pgEnum('estado_tarea', ESTADOS_TAREA);

export const resultadoAccion = pgEnum('resultado_accion', RESULTADOS_ACCION);

/**
 * Sentido de una decisión de aprobación. Sin «pendiente»: una aprobación pendiente
 * es la que no tiene fila en `decision_aprobacion`.
 */
export const sentidoDecision = pgEnum('sentido_decision', SENTIDOS_DECISION);

export const tipoSenal = pgEnum('tipo_senal', TIPOS_SENAL);

export const estadoLeccion = pgEnum('estado_leccion', ESTADOS_LECCION);

export const tipoOperacion = pgEnum('tipo_operacion', TIPOS_OPERACION);

export const estadoPropuesta = pgEnum('estado_propuesta', ESTADOS_PROPUESTA);

export const tipoActor = pgEnum('tipo_actor', TIPOS_ACTOR);

export const tipoConector = pgEnum('tipo_conector', TIPOS_CONECTOR);

export const estadoConector = pgEnum('estado_conector', ESTADOS_CONECTOR);

export const tipoDisparador = pgEnum('tipo_disparador', TIPOS_DISPARADOR);

/** Los tres ámbitos de la memoria y del conocimiento. */
export const ambito = pgEnum('ambito', AMBITOS);

export const rolParticipante = pgEnum('rol_participante', ROLES_PARTICIPANTE);

export const canalNotificacion = pgEnum('canal_notificacion', CANALES_NOTIFICACION);

export const estadoNotificacion = pgEnum('estado_notificacion', ESTADOS_NOTIFICACION);

export const estadoEventoSalida = pgEnum('estado_evento_salida', ESTADOS_EVENTO_SALIDA);
