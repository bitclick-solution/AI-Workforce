/**
 * Vocabulario compartido de la sala: adjuntos de mensaje, nombres de flujos y
 * señales, y las cargas que viajan entre la API y el trabajador.
 *
 * La API arranca y señala flujos por nombre y el trabajador los registra con esos
 * mismos nombres. Si cada lado escribiera el suyo, el primer cambio de nombre
 * dejaría mensajes sin moderar sin que nada fallase.
 */

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
