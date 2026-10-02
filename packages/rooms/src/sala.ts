/**
 * Vocabulario compartido de la sala: adjuntos de mensaje, nombres de flujos y
 * señales, y las cargas que viajan entre la API y el trabajador.
 *
 * La API arranca y señala flujos por nombre y el trabajador los registra con esos
 * mismos nombres. Si cada lado escribiera el suyo, el primer cambio de nombre
 * dejaría mensajes sin moderar sin que nada fallase.
 */
import type { PasoDeModeloDeSala } from './moderador-modelo.js';
import { normalizar } from './moderador.js';

export const FLUJO_MENSAJE_DE_SALA = 'mensajeDeSala';
export const FLUJO_PROPUESTA_DE_OPERACION = 'propuestaDeOperacion';
export const SENAL_DECISION_PROPUESTA = 'decisionDePropuesta';

/** Nombre de la sala general de cada organización (ADR-004). */
export const NOMBRE_SALA_GENERAL = 'General';

/** El identificador del flujo es el del mensaje: publicar dos veces no modera dos. */
export function idFlujoMensaje(mensajeId: string): string {
  return `sala-mensaje-${mensajeId}`;
}

export function idFlujoPropuesta(propuestaId: string): string {
  return `propuesta-${propuestaId}`;
}

// Sala v1: salas por equipo y presencia en vivo (ADR-022).

/**
 * Flujo que crea la sala de un departamento si falta y sincroniza sus
 * participantes (puestos activos o en prueba, y la persona que lo supervisa) con
 * `sala_participante`. Se llama con el identificador del departamento y es
 * idempotente: se puede repetir sin duplicar miembros ni auditoría.
 */
export const FLUJO_SINCRONIZAR_SALA_DE_EQUIPO = 'sincronizarSalaDeEquipo';

/** Una sala por departamento: repetir la sincronización encuentra el mismo flujo. */
export function idFlujoSincronizarEquipo(departamentoId: string): string {
  return `sala-equipo-${departamentoId}`;
}

/** Prefijo de canal privado (Centrifugo exige token de suscripción para verlo). */
export const PREFIJO_CANAL_SALA = 'sala:';

/** Canal de Centrifugo de una sala: mensajes, presencia y «escribiendo» del ADR-022. */
export function canalDeSala(tenantId: string, salaId: string): string {
  return `${PREFIJO_CANAL_SALA}${tenantId}:${salaId}`;
}

/** Cuánto vive un token de conexión o de canal antes de que el cliente pida otro. */
export const SEGUNDOS_TOKEN_CENTRIFUGO = 5 * 60;

/**
 * Si `texto` menciona a `nombrePersona` (`@` seguida del nombre completo sin
 * espacios o de su primera palabra), igual que `moderar` reconoce la mención de
 * un puesto. Sirve para contar «menciones» en `ResumenDeSala`.
 */
export function mencionaAPersona(nombrePersona: string, texto: string): boolean {
  const normalizado = normalizar(nombrePersona).split(' ').filter(Boolean);
  if (normalizado.length === 0) return false;
  const junto = normalizado.join('');
  const primera = normalizado[0];
  return normalizar(texto)
    .split(' ')
    .filter(Boolean)
    .some(
      (palabra) =>
        palabra.startsWith('@') &&
        (palabra.slice(1) === junto || (primera !== undefined && palabra.slice(1) === primera)),
    );
}

export type AgentePlataforma = 'moderador' | 'director_ia';

/**
 * Adjuntos de un mensaje. Un mensaje de un agente de plataforma no tiene puesto ni
 * persona autora: lo dice el adjunto `autor_plataforma`.
 */
export type AdjuntoDeSala =
  | { tipo: 'autor_plataforma'; agente: AgentePlataforma }
  | {
      tipo: 'moderacion';
      decision: 'intervenir' | 'operacion' | 'silencio';
      puestos: string[];
      motivo: string;
      /** Paso de modelo: si se dio, con qué resultado y a qué coste. Ausente en las salas sin modelo. */
      pasoDeModelo?: PasoDeModeloDeSala;
    }
  | { tipo: 'intervencion'; intervencionId: string; tareaId: string; estado: string }
  | { tipo: 'propuesta_operacion'; propuestaId: string };

/** Lo que la API pasa al flujo `mensajeDeSala`. El identificador lo pone la API. */
export interface EntradaMensajeDeSala {
  tenantId: string;
  salaId: string;
  mensajeId: string;
  personaId: string;
  texto: string;
}

export type SentidoPropuesta = 'aprobada' | 'rechazada';

/** Carga de la señal `decisionDePropuesta`: el clic de la persona. */
export interface CargaDecisionPropuesta {
  personaId: string;
  sentido: SentidoPropuesta;
  motivo?: string | undefined;
}

/** Límite de texto de un mensaje humano. Más largo no es una pregunta de sala. */
export const LONGITUD_MAXIMA_MENSAJE = 2000;
