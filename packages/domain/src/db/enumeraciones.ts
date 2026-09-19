/**
 * Enumeraciones del modelo. Van en columnas porque se filtran y se ordenan;
 * lo que varía por cliente vive en `jsonb` validado con Zod.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const planOrganizacion = pgEnum('plan_organizacion', ['starter', 'business', 'enterprise']);

export const estadoOrganizacion = pgEnum('estado_organizacion', [
  'activa',
  'pausada',
  'dada_de_baja',
]);

export const estadoDepartamento = pgEnum('estado_departamento', [
  'propuesto',
  'activo',
  'pausado',
  'disuelto',
  'fusionado',
]);

export const estadoPuesto = pgEnum('estado_puesto', [
  'propuesto',
  'en_prueba',
  'activo',
  'pausado',
  'degradado',
  'dado_de_baja',
]);

export const claseRiesgo = pgEnum('clase_riesgo', ['bajo', 'medio', 'alto', 'critico']);

/** Niveles de autonomía por clase de acción (ADR-003). N0 propone, N3 actúa solo. */
export const nivelAutonomia = pgEnum('nivel_autonomia', ['n0', 'n1', 'n2', 'n3']);

export const origenTarea = pgEnum('origen_tarea', [
  'sala',
  'canal',
  'programacion',
  'delegacion',
  'manual',
]);

/** Proyección del estado que dicta el historial de Temporal. Se puede reconstruir. */
export const estadoTarea = pgEnum('estado_tarea', [
  'pendiente',
  'en_curso',
  'esperando_aprobacion',
  'completada',
  'fallida',
  'cancelada',
]);

export const resultadoAccion = pgEnum('resultado_accion', [
  'exito',
  'error',
  'rechazado',
  'parcial',
]);

export const decisionAprobacion = pgEnum('decision_aprobacion', [
  'pendiente',
  'aprobada',
  'rechazada',
  'editada',
]);

export const tipoSenal = pgEnum('tipo_senal', [
  'aprobacion',
  'correccion',
  'queja',
  'eval',
  'metrica',
  'incidencia',
]);

export const estadoLeccion = pgEnum('estado_leccion', [
  'propuesta',
  'evaluada',
  'promocionada',
  'descartada',
]);

export const tipoOperacion = pgEnum('tipo_operacion', [
  'crear_departamento',
  'disolver_departamento',
  'contratar',
  'mover',
  'pausar',
  'dar_de_baja',
  'conectar',
  'cambiar_nivel',
  'cambiar_presupuesto',
  'publicar_manual',
]);

export const estadoPropuesta = pgEnum('estado_propuesta', [
  'borrador',
  'pendiente',
  'aprobada',
  'rechazada',
  'ejecutada',
  'revertida',
]);

export const tipoActor = pgEnum('tipo_actor', ['persona', 'agente', 'plataforma', 'sistema']);

export const tipoConector = pgEnum('tipo_conector', ['mcp', 'nango', 'n8n', 'interno']);

export const estadoConector = pgEnum('estado_conector', [
  'configurado',
  'activo',
  'pausado',
  'error',
]);

export const tipoDisparador = pgEnum('tipo_disparador', [
  'programacion',
  'evento',
  'mensaje',
  'sala',
  'delegacion',
]);

/** Los tres ámbitos de la memoria y del conocimiento. */
export const ambito = pgEnum('ambito', ['organizacion', 'departamento', 'puesto']);

export const rolParticipante = pgEnum('rol_participante', [
  'humano',
  'agente',
  'moderador',
  'observador',
]);

export const canalNotificacion = pgEnum('canal_notificacion', [
  'panel',
  'correo',
  'whatsapp',
  'slack',
  'teams',
]);

export const estadoNotificacion = pgEnum('estado_notificacion', [
  'pendiente',
  'enviada',
  'leida',
  'vencida',
  'escalada',
]);

export const estadoEventoSalida = pgEnum('estado_evento_salida', [
  'pendiente',
  'publicado',
  'fallido',
]);
