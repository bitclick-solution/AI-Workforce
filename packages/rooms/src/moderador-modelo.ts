/**
 * Moderador de la sala de un departamento con paso de modelo.
 *
 * Envuelve `moderar()` sin tocar su firma: las reglas mandan, y solo cuando no
 * encuentran ni un tema ni una mención ni una petición de contratar, y la sala es la
 * de un departamento, el modelo decide si aun así debería intervenir un puesto de la
 * sala. Clasifica, no redacta: elige `puestoId` de la lista que recibe (enumeración
 * cerrada) y, como mucho, el límite del ADR-004. En la sala general no se llama al
 * modelo nunca (docs/specs/sala-departamento-moderador-modelo.md, decisión 1).
 */
import { z } from 'zod';

import { clasificar, type PuertoDeClasificacion } from './clasificacion.js';
import {
  ESTADOS_QUE_INTERVIENEN,
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  moderar,
  type DecisionDelModerador,
  type OpcionesModerador,
  type ParticipanteDeSala,
} from './moderador.js';
import promptDelModerador from './prompts/moderador.json' with { type: 'json' };

export const PROMPT_DEL_MODERADOR: { version: number; sistema: string } = promptDelModerador;

/** Ámbito de la sala donde el moderador da el paso de modelo. */
export const AMBITO_CON_MODELO = 'departamento';

/** Qué pasó con el paso de modelo en esta decisión: va en el adjunto `moderacion`. */
export type PasoDeModeloDeSala =
  | { usado: false; razon: 'reglas_decidieron' | 'sala_general' | 'sin_agentes' | 'sin_puerto' }
  | {
      usado: true;
      resultado: 'intervenir' | 'operacion' | 'silencio' | 'no_disponible';
      costeEuros: number;
      llamadas: number;
      version: number;
      motivo: string;
    };

export interface ResultadoDeModeracion {
  decision: DecisionDelModerador;
  pasoDeModelo: PasoDeModeloDeSala;
}

export interface OpcionesModeradorConModelo extends OpcionesModerador {
  /** `sala.ambito`. Solo `departamento` da el paso de modelo. */
  ambito: string;
  /** Sin puerto, el moderador es el de reglas de siempre. */
  clasificador?: PuertoDeClasificacion | undefined;
}

function esquemaDelModerador(puestoIds: readonly string[]) {
  const ids = puestoIds as [string, ...string[]];
  return z.object({
    puestoIds: z.array(z.enum(ids)).max(LIMITE_MAXIMO),
    pideOperacion: z.boolean(),
    motivo: z.string().min(1).max(300),
  });
}

function entradaDelModelo(texto: string, disponibles: readonly ParticipanteDeSala[]): string {
  return JSON.stringify({
    mensaje: texto,
    puestos: disponibles.map((p) => ({ puestoId: p.puestoId, nombre: p.nombre, temas: p.temas })),
  });
}

export async function moderarConModelo(
  texto: string,
  participantes: readonly ParticipanteDeSala[],
  opciones: OpcionesModeradorConModelo,
): Promise<ResultadoDeModeracion> {
  const porReglas = moderar(texto, participantes, opciones);
  if (porReglas.tipo !== 'silencio') {
    return { decision: porReglas, pasoDeModelo: { usado: false, razon: 'reglas_decidieron' } };
  }
  if (opciones.ambito !== AMBITO_CON_MODELO) {
    return { decision: porReglas, pasoDeModelo: { usado: false, razon: 'sala_general' } };
  }
  const disponibles = participantes.filter((p) =>
    (ESTADOS_QUE_INTERVIENEN as readonly string[]).includes(p.estado),
  );
  // Sin nadie que pueda hablar no hay a quién elegir: el silencio de reglas es el bueno.
  if (disponibles.length === 0) {
    return { decision: porReglas, pasoDeModelo: { usado: false, razon: 'sin_agentes' } };
  }
  if (opciones.clasificador === undefined) {
    return { decision: porReglas, pasoDeModelo: { usado: false, razon: 'sin_puerto' } };
  }

  const resultado = await clasificar(opciones.clasificador, {
    sistema: PROMPT_DEL_MODERADOR.sistema,
    usuario: entradaDelModelo(texto, disponibles),
    esquema: esquemaDelModerador(disponibles.map((p) => p.puestoId)),
  });
  const version = PROMPT_DEL_MODERADOR.version;

  if (resultado.tipo === 'no_disponible') {
    return {
      decision: {
        tipo: 'silencio',
        motivo: `${porReglas.motivo} Además, ${resultado.motivo}.`,
      },
      pasoDeModelo: {
        usado: true,
        resultado: 'no_disponible',
        costeEuros: resultado.costeEuros,
        llamadas: resultado.llamadas,
        version,
        motivo: resultado.motivo,
      },
    };
  }

  const { puestoIds, pideOperacion, motivo } = resultado.salida;
  const base = { costeEuros: resultado.costeEuros, llamadas: resultado.llamadas, version, motivo };
  const limite = Math.min(
    Math.max(Math.trunc(opciones.limite ?? LIMITE_POR_DEFECTO), LIMITE_POR_DEFECTO),
    LIMITE_MAXIMO,
  );

  const elegidos = [...new Set(puestoIds)]
    .map((id) => disponibles.find((p) => p.puestoId === id))
    .filter((p): p is ParticipanteDeSala => p !== undefined)
    .slice(0, limite);

  if (elegidos.length > 0) {
    return {
      decision: {
        tipo: 'intervenir',
        turnos: elegidos.map((p) => ({
          puestoId: p.puestoId,
          nombre: p.nombre,
          motivo: `Paso de modelo: ${motivo}`,
          porMencion: false,
          coincidencias: 0,
        })),
        motivo:
          `Ningún tema literal de las fichas; el paso de modelo da la palabra a ` +
          `${elegidos.map((p) => p.nombre).join(' y ')} (límite ${limite}).`,
      },
      pasoDeModelo: { usado: true, resultado: 'intervenir', ...base },
    };
  }

  if (pideOperacion) {
    return {
      decision: {
        tipo: 'operacion',
        operacion: 'contratar',
        motivo:
          'Paso de modelo: el mensaje pide una operación de organización, con otras palabras ' +
          'que las fijas, y la atiende el Director de IA.',
      },
      pasoDeModelo: { usado: true, resultado: 'operacion', ...base },
    };
  }

  return {
    decision: {
      tipo: 'silencio',
      motivo: `${porReglas.motivo} El paso de modelo tampoco da la palabra a nadie: ${motivo}`,
    },
    pasoDeModelo: { usado: true, resultado: 'silencio', ...base },
  };
}
