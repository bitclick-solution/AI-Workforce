/**
 * Contratos entre el bucle y sus actividades.
 *
 * Viven en su propio módulo porque los importan las dos mitades del trabajador y
 * cada mitad tiene una regla distinta: el flujo se compila a un paquete aislado
 * sin acceso a la red ni al sistema de ficheros, y las actividades corren en Node
 * con todo a mano. Un tipo compartido puede cruzar esa frontera; una función con
 * efectos, no.
 *
 * Todo lo que viaja aquí es serializable a JSON, porque va al historial de
 * Temporal. Nada de `Date`, nada de clases, nada de funciones: si algo no cabe en
 * el historial, no se puede reanudar un flujo con él.
 */
import type { ContratoDelegacion, Nivel, SentidoDecision, TipoClaseAccion } from '@aiw/domain';

/** Quién ejecuta y con qué versión. Va a cada entrada del libro y a cada traza. */
export interface IdentidadDeEjecucion {
  tenantId: string;
  puestoId: string;
  versionPuestoId: string;
  tareaId: string;
}

/** Herramienta del catálogo, tal como el flujo la necesita para decidir. */
export interface HerramientaDelCatalogo {
  nombre: string;
  descripcion: string;
  tipo: TipoClaseAccion;
  claseAccion: string;
  esquemaEntrada: unknown;
  conector: string;
}

/**
 * Lo que el bucle necesita saber antes de empezar, y que vuelve a leer cuando el
 * estado del puesto puede haber cambiado.
 */
export interface ContextoDeEjecucion {
  estadoPuesto: string;
  /** Prompt de sistema ya compuesto y cacheado por versión de puesto. */
  sistema: string;
  herramientas: HerramientaDelCatalogo[];
  /** Nivel efectivo por clase: autorización con el techo de la política. */
  nivelesPorClase: Record<string, Nivel>;
  clasesProhibidas: string[];
  guardiasEntrada: string[];
  guardiasSalida: string[];
  /** Límite de la tarea en euros. Nulo cuando no se declaró ninguno. */
  presupuestoEuros: number | null;
  gastadoEuros: number;
}

/** Mensaje de la conversación, en la forma mínima que el historial puede guardar. */
export interface MensajeDeConversacion {
  papel: 'usuario' | 'agente' | 'herramienta';
  texto: string;
  /** Presente en los mensajes de herramienta: a qué llamada contesta. */
  llamadaId?: string | undefined;
  herramienta?: string | undefined;
}

export interface LlamadaPedidaPorElModelo {
  id: string;
  herramienta: string;
  argumentos: Record<string, unknown>;
}

export interface PeticionPasoModelo extends IdentidadDeEjecucion {
  sistema: string;
  mensajes: MensajeDeConversacion[];
  herramientas: HerramientaDelCatalogo[];
  numeroPaso: number;
  guardiasSalida: string[];
  /** Clave que hace idempotente el cobro del uso si la actividad se reintenta. */
  claveIdempotencia: string;
}

export interface SalidaPasoModelo {
  texto: string;
  llamadas: LlamadaPedidaPorElModelo[];
  costeEuros: number;
  /** Coste acumulado de la tarea raíz tras este paso. Lo dice la base, no el bucle. */
  gastadoEuros: number;
  motivoFin: string;
  /** Guardia de salida que se disparó, si alguna. El texto ya viene saneado. */
  guardiaDisparada?: string | undefined;
}

export interface PeticionPasoHerramienta extends IdentidadDeEjecucion {
  herramienta: string;
  argumentos: Record<string, unknown>;
  numeroPaso: number;
  claveIdempotencia: string;
  nivelAplicado: Nivel | null;
  guardiasEntrada: string[];
  /**
   * Guardias de salida para lo que se escribe donde no se borra: los argumentos van
   * a la fila del paso ya revisados. Al conector llegan tal cual.
   */
  guardiasSalida: string[];
  presupuestoEuros: number | null;
  gastadoEuros: number;
  /** Aprobación decidida que desbloquea un paso supervisado. */
  aprobacionId?: string | undefined;
}

export interface SalidaPasoHerramienta {
  texto: string;
  duracionMs: number;
  /** `true` cuando el paso ya estaba ejecutado y no se repitió (reanudación). */
  yaEstaba: boolean;
}

export interface PeticionDeAprobacion extends IdentidadDeEjecucion {
  claseAccion: string;
  nivelExigido: Nivel;
  /** Carga opaca (ADR-001): el plano de control no la interpreta. */
  borradorOpaco: { tipo: string; carga: unknown };
  resumenLegible: string;
  /** El resumen pasa por estos guardias antes de guardarse: lo lee una persona en un correo. */
  guardiasSalida: string[];
  numeroPaso: number;
  /** Validez de la aprobación en segundos. Al vencer, la resuelve la plataforma. */
  validezSegundos: number;
}

export interface AprobacionCreada {
  aprobacionId: string;
  /** `true` cuando ya existía de un intento anterior: no se pide permiso dos veces. */
  yaEstaba: boolean;
}

/** Decisión que llega por señal o que se consulta en la base al reanudar. */
export interface DecisionRecibida {
  aprobacionId: string;
  sentido: SentidoDecision;
  personaId: string | null;
  motivo?: string | undefined;
  /** Argumentos corregidos por la persona, cuando el sentido es `editada`. */
  argumentosEditados?: Record<string, unknown> | undefined;
}

export interface PeticionAnotarPaso extends IdentidadDeEjecucion {
  numeroPaso: number;
  tipo: string;
  herramienta?: string | undefined;
  accion: string;
  resultado: 'exito' | 'error' | 'rechazado' | 'parcial';
  nivelAplicado?: Nivel | null | undefined;
  motivo: string;
  entrada?: Record<string, unknown> | undefined;
  /** Guardias de salida para `entrada`: los argumentos se escriben revisados. */
  guardiasSalida: string[];
  salida?: Record<string, unknown> | undefined;
  duracionMs?: number | undefined;
}

export interface PeticionProyectarEstado {
  tenantId: string;
  tareaId: string;
  estado:
    'pendiente' | 'en_curso' | 'esperando_aprobacion' | 'completada' | 'fallida' | 'cancelada';
  resultado?: Record<string, unknown> | undefined;
  flujoTemporalId?: string | undefined;
  ejecucionTemporalId?: string | undefined;
}

/** Señal de aprendizaje: lo que el bucle observa y el aprendizaje leerá después. */
export interface PeticionSenalDeAprendizaje extends IdentidadDeEjecucion {
  tipo: 'aprobacion' | 'correccion' | 'queja' | 'eval' | 'metrica' | 'incidencia';
  resumen: string;
  detalle: Record<string, unknown>;
  /** Entre -1 y 1. Negativo cuando la señal es mala para el agente. */
  puntuacion?: number | undefined;
}

export interface PeticionAbrirDelegacion extends IdentidadDeEjecucion {
  puestoDestinoNombre: string;
  contrato: ContratoDelegacion;
}

export interface DelegacionAbierta {
  delegacionId: string;
  tareaDestinoId: string;
  puestoDestinoId: string;
  versionPuestoDestinoId: string;
  /**
   * Presupuesto del hijo ya acotado al restante del padre. Es el que se escribió en
   * `tarea` y en `delegacion`, y el que va en el contrato que recibe el flujo hijo.
   */
  presupuestoEuros: number;
  /** Plazo absoluto en ISO 8601, calculado por la actividad con el reloj de la base. */
  plazo: string;
  yaEstaba: boolean;
}

export interface PeticionCerrarDelegacion {
  tenantId: string;
  delegacionId: string;
  resultado: Record<string, unknown>;
}

/** Entrada del flujo de la tarea. Es lo que queda en el historial de Temporal. */
export interface EntradaTareaAgente extends IdentidadDeEjecucion {
  /** Lo que se le pide al agente, en idioma de negocio. */
  encargo: string;
  /** Solo herramientas de lectura: la intervención en la sala no escribe (sala v0). */
  soloLectura?: boolean | undefined;
  /** Tope de vueltas del bucle. Protege de un modelo que no sabe parar. */
  maxPasos?: number | undefined;
  /** Validez de cada aprobación, en segundos. */
  validezAprobacionSegundos?: number | undefined;
  /** Contrato de la delegación que abre el flujo tras las escrituras, si la abre. */
  delegacion?: { puestoDestinoNombre: string; contrato: ContratoDelegacion } | undefined;
  /**
   * Aprendizaje v0: una edición del borrador arranca el flujo `aprendizajeDeSenal`.
   * Lo pone quien arranca la tarea a partir de la bandera `AIW_APRENDIZAJE_V0`,
   * porque el flujo no puede leer el entorno sin dejar de ser determinista.
   */
  aprendizaje?: boolean | undefined;
}

export interface ResultadoTareaAgente {
  estado: 'completada' | 'fallida' | 'esperando_aprobacion';
  resumen: string;
  pasos: number;
  costeEuros: number;
  aprobacionesPedidas: number;
  escriturasEjecutadas: number;
  escriturasSaltadas: number;
  escriturasSimuladas: number;
  delegacion?:
    | {
        tareaDestinoId: string;
        entregado: boolean;
        resumen: string;
        respaldoAplicado?: string | undefined;
      }
    | undefined;
  motivo?: string | undefined;
}

/** Entrada del flujo hijo. El contrato completo, validado por el padre. */
export interface EntradaDelegacion extends IdentidadDeEjecucion {
  delegacionId: string;
  tareaOrigenId: string;
  contrato: ContratoDelegacion;
}

export interface ResultadoDelegacionHija {
  tareaDestinoId: string;
  entregado: boolean;
  resumen: string;
  costeEuros: number;
}
