/**
 * Contrato entre la interfaz de Sala v1 y sus datos (ADR-022). Copia literal en
 * las ramas del Diseñador y del Constructor; no se cambia sin acordarlo.
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

export interface FuenteDeSala {
  salas(): Promise<ResumenDeSala[]>;
  miembros(salaId: string): Promise<MiembroDeSala[]>;
  /** Cambios en vivo de una sala; devuelve la función para darse de baja. */
  suscribir(salaId: string, alCambiar: (cambio: CambioDeSala) => void): () => void;
  /** Avisa de que la persona está escribiendo en la sala. */
  indicarEscritura(salaId: string): void;
}
