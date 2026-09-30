/**
 * Contrato entre la interfaz de Sala v1 y sus datos (ADR-022). Copia literal en
 * las ramas del Diseñador y del Constructor; no se cambia sin acordarlo.
 *
 * Acuerdo de la rebanada «Sala v1 · conversación real» (aprobada por Jesús,
 * 2026-09-30): el contrato gana la conversación —leer, enviar y confirmar
 * propuestas—, que hasta ahora quedaba fuera («Conversación fuera del
 * contrato», docs/specs/sala-v1-interfaz.md). Las formas y los campos son una
 * copia declarada del contrato JSON de `apps/api/src/rutas/sala.ts` (v0), el
 * mismo que ya usa `apps/web/lib/sala.ts`.
 */

/** Estados del ADR-022. Los tres últimos solo aplican a agentes. */
export type EstadoDePresencia =
  | 'en-la-sala'
  | 'escribiendo'
  | 'inactivo'
  | 'anadido'
  | 'trabajando'
  | 'te-necesita'
  | 'en-pausa';

export interface MiembroDeSala {
  id: string;
  tipo: 'persona' | 'agente';
  nombre: string;
  /** Agentes: nombre del puesto. */
  puesto?: string;
  equipo?: string;
  estado: EstadoDePresencia;
  /** ISO 8601: desde cuándo está en ese estado. */
  desde?: string;
}

export interface ResumenDeSala {
  id: string;
  nombre: string;
  ambito: 'general' | 'equipo';
  sinLeer: number;
  menciones: number;
}

export type CambioDeSala =
  | { tipo: 'mensaje'; salaId: string }
  | { tipo: 'presencia'; salaId: string; miembro: MiembroDeSala }
  | { tipo: 'escribiendo'; salaId: string; miembroId: string; hasta: string };

export interface AutorDeMensaje {
  tipo: 'persona' | 'puesto' | 'plataforma';
  nombre: string;
}

/**
 * Adjunto de un mensaje, tal como lo entrega la API (v0): `moderacion` pliega
 * la nota del moderador; `propuesta_operacion` enlaza con una `PropuestaDeSala`
 * por `propuestaId`. El tipo `aprobacion` (una acción inmediata que pide
 * confirmación, sin pasar por una propuesta de operación) todavía no lo emite
 * la API real —está fuera de alcance de Sala v0, ver «aprobaciones desde la
 * intervención» en _De conversación a trabajo_—, así que hoy solo lo produce
 * `sala-simulada.ts` para la conversación de ejemplo; la traducción de
 * `apps/web/app/panel/sala/_v1/traduccion.ts` ya sabe pintarlo para cuando
 * llegue de verdad.
 */
export interface AdjuntoDeSala {
  tipo: string;
  agente?: string;
  decision?: string;
  motivo?: string;
  propuestaId?: string;
  estado?: string;
  /** Solo en adjuntos `aprobacion`. */
  titulo?: string;
  resumen?: string;
  porque?: string;
}

export interface MensajeDeSala {
  id: string;
  cuerpo: string;
  autor: AutorDeMensaje;
  adjuntos: AdjuntoDeSala[];
  creadoEn: string;
}

export interface EfectosDeContratacion {
  puesto?: { nombre?: string; ficha?: { mision?: string; tareas?: string[]; limites?: string[] } };
  herramientas?: {
    disponibles?: { nombre: string; descripcion: string; conectorNombre?: string }[];
    porConectar?: { nombre: string; descripcion: string }[];
  };
  guardrails?: { clase: string; regla: string }[];
  coste?: { tareasMes: number; eurosMesCliente: number; eurosMesModelo: number };
  reversion?: { descripcion?: string };
}

export interface PropuestaDeSala {
  id: string;
  resumen: string;
  estado: string;
  nivelExigido: string;
  costeEstimadoEuros: number;
  efectos: EfectosDeContratacion;
}

export interface ConversacionDeSala {
  mensajes: MensajeDeSala[];
  propuestas: PropuestaDeSala[];
}

export interface FuenteDeSala {
  salas(): Promise<ResumenDeSala[]>;
  miembros(salaId: string): Promise<MiembroDeSala[]>;
  /** Cambios en vivo de una sala; devuelve la función para darse de baja. */
  suscribir(salaId: string, alCambiar: (cambio: CambioDeSala) => void): () => void;
  /** Avisa de que la persona está escribiendo en la sala. */
  indicarEscritura(salaId: string): void;
  /** Mensajes de la sala y las propuestas de operación que citan. */
  mensajes(salaId: string): Promise<ConversacionDeSala>;
  /** Envía un mensaje de la persona a la sala. */
  enviarMensaje(salaId: string, texto: string): Promise<void>;
  /** Confirma o descarta una propuesta de operación pendiente. */
  decidirPropuesta(propuestaId: string, sentido: 'aprobada' | 'rechazada'): Promise<void>;
}
