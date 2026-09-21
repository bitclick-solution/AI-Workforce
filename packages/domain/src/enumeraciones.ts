/**
 * Valores de las enumeraciones del dominio.
 *
 * Viven aquí, sin depender de Drizzle ni de PostgreSQL, porque son vocabulario del
 * negocio y no de la base: `@aiw/db` construye con ellos los tipos `enum` de
 * PostgreSQL y los esquemas Zod de `./esquemas` los usan para validar. Una sola
 * lista por concepto, y todo lo que la usa queda cuadrado por construcción.
 */

/** Planes comerciales del ADR-011. Es hipótesis: se revisa al cierre de la fase 1. */
export const PLANES = [
  'departamento',
  'equipo',
  'workforce',
  'business',
  'enterprise',
  'asesoria',
] as const;

export const ESTADOS_ORGANIZACION = ['activa', 'pausada', 'dada_de_baja'] as const;

export const ESTADOS_DEPARTAMENTO = [
  'propuesto',
  'activo',
  'pausado',
  'disuelto',
  'fusionado',
] as const;

export const ESTADOS_PUESTO = [
  'propuesto',
  'en_prueba',
  'activo',
  'pausado',
  'degradado',
  'dado_de_baja',
] as const;

export const CLASES_RIESGO = ['bajo', 'medio', 'alto', 'critico'] as const;

/** Niveles de autonomía por clase de acción (ADR-003). N0 propone, N3 actúa solo. */
export const NIVELES = ['n0', 'n1', 'n2', 'n3'] as const;

export const ORIGENES_TAREA = ['sala', 'canal', 'programacion', 'delegacion', 'manual'] as const;

/** Proyección del estado que dicta el historial de Temporal. Se puede reconstruir. */
export const ESTADOS_TAREA = [
  'pendiente',
  'en_curso',
  'esperando_aprobacion',
  'completada',
  'fallida',
  'cancelada',
] as const;

export const RESULTADOS_ACCION = ['exito', 'error', 'rechazado', 'parcial'] as const;

/**
 * Sentido de una decisión de aprobación. No hay «pendiente»: una aprobación sin
 * decisión es una aprobación sin fila en `decision_aprobacion` (ADR-005).
 */
export const SENTIDOS_DECISION = ['aprobada', 'rechazada', 'editada'] as const;

export const TIPOS_SENAL = [
  'aprobacion',
  'correccion',
  'queja',
  'eval',
  'metrica',
  'incidencia',
] as const;

export const ESTADOS_LECCION = ['propuesta', 'evaluada', 'promocionada', 'descartada'] as const;

export const TIPOS_OPERACION = [
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
] as const;

export const ESTADOS_PROPUESTA = [
  'borrador',
  'pendiente',
  'aprobada',
  'rechazada',
  'ejecutada',
  'revertida',
] as const;

export const TIPOS_ACTOR = ['persona', 'agente', 'plataforma', 'sistema'] as const;

export const TIPOS_CONECTOR = ['mcp', 'nango', 'n8n', 'interno'] as const;

export const ESTADOS_CONECTOR = ['configurado', 'activo', 'pausado', 'error'] as const;

export const TIPOS_DISPARADOR = [
  'programacion',
  'evento',
  'mensaje',
  'sala',
  'delegacion',
] as const;

/** Los tres ámbitos de la memoria y del conocimiento. */
export const AMBITOS = ['organizacion', 'departamento', 'puesto'] as const;

export const ROLES_PARTICIPANTE = ['humano', 'agente', 'moderador', 'observador'] as const;

export const CANALES_NOTIFICACION = ['panel', 'correo', 'whatsapp', 'slack', 'teams'] as const;

export const ESTADOS_NOTIFICACION = [
  'pendiente',
  'enviada',
  'leida',
  'vencida',
  'escalada',
] as const;

export const ESTADOS_EVENTO_SALIDA = ['pendiente', 'publicado', 'fallido'] as const;

export type Plan = (typeof PLANES)[number];
export type EstadoPuesto = (typeof ESTADOS_PUESTO)[number];
export type EstadoTarea = (typeof ESTADOS_TAREA)[number];
export type ResultadoAccion = (typeof RESULTADOS_ACCION)[number];
export type Nivel = (typeof NIVELES)[number];
export type Ambito = (typeof AMBITOS)[number];
export type SentidoDecision = (typeof SENTIDOS_DECISION)[number];
