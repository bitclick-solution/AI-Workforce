/**
 * Contrato de la delegación entre agentes.
 *
 * El ADR-004 fija cuatro campos —encargo, plazo, presupuesto y formato— y el
 * ADR-014 añade dos más que no son opcionales: caducidad y política de respaldo.
 * La razón de que sean obligatorios es simple: sin ellos, un agente que pide algo a
 * otro y no recibe respuesta se queda esperando, y un flujo que espera para siempre
 * es una tarea que nadie ve fallar.
 *
 * Los plazos van en segundos y no en fechas. Un flujo durable puede reanudarse
 * meses después de arrancar, y una fecha absoluta calculada en el proceso que lo
 * lanzó no significa lo mismo al reanudar; una duración sí. La fecha absoluta la
 * calcula el flujo padre al abrir la delegación y la escribe en `delegacion.plazo`,
 * que es lo que lee el panel.
 */
import { z } from 'zod';

import { formatoDelegacion } from './esquemas/index.js';

/**
 * Qué hace el que delegó cuando el plazo vence sin respuesta (ADR-014).
 *
 * - `seguir_sin_ello`: el padre continúa sin el resultado y lo dice en el suyo.
 * - `aparcar`: el padre no continúa; la tarea queda a la espera de una persona.
 * - `escalar_a_persona`: se abre una aprobación para que alguien decida.
 */
export const POLITICAS_RESPALDO = ['seguir_sin_ello', 'aparcar', 'escalar_a_persona'] as const;

export type PoliticaRespaldo = (typeof POLITICAS_RESPALDO)[number];

/**
 * El contrato completo. Se valida al abrir la delegación, no al recibirla: si el
 * encargo no cumple el contrato, el fallo sale en el padre, que es quien lo escribió.
 */
export const contratoDelegacion = z
  .object({
    /** Qué se pide, en idioma de negocio. Va al modelo del hijo y al libro. */
    encargo: z.string().min(1),
    /** Cuánto tiene el hijo para entregar, en segundos. */
    plazoSegundos: z.number().int().positive(),
    /** Presupuesto del hijo, acotado al restante del padre. Cero es «no gastes». */
    presupuestoEuros: z.number().nonnegative(),
    formato: formatoDelegacion,
    /**
     * Cuándo deja de valer la petición, en segundos. Nunca antes del plazo: una
     * petición que caduca antes de su propio plazo no se puede cumplir.
     */
    caducidadSegundos: z.number().int().positive(),
    politicaRespaldo: z.enum(POLITICAS_RESPALDO),
  })
  .refine((contrato) => contrato.caducidadSegundos >= contrato.plazoSegundos, {
    message: 'La caducidad no puede ser anterior al plazo: la petición sería imposible de cumplir.',
    path: ['caducidadSegundos'],
  });

export type ContratoDelegacion = z.infer<typeof contratoDelegacion>;

/** Lo que el hijo devuelve. El padre no interpreta la carga: la pasa a su bucle. */
export const resultadoDelegacion = z.object({
  tareaDestinoId: z.string().min(1),
  entregado: z.boolean(),
  resumen: z.string().min(1),
  carga: z.unknown().optional(),
  costeEuros: z.number().nonnegative(),
});

export type ResultadoDelegacion = z.infer<typeof resultadoDelegacion>;

export interface Respaldo {
  /** Si el padre sigue con su bucle sin el resultado del hijo. */
  continua: boolean;
  /** Si hace falta que decida una persona antes de seguir. */
  escala: boolean;
  /** Frase que va al libro y al resultado de la tarea. */
  motivo: string;
}

/**
 * Traduce la política de respaldo a lo que hace el padre cuando vence el plazo.
 *
 * Es una función y no un `switch` repartido por el flujo porque el ADR-014 exige
 * que la política se aplique «y se registre como hecho»: con un solo sitio que la
 * traduzca, el motivo que se anota es siempre el mismo texto.
 */
/**
 * Acota el presupuesto que pide un contrato al restante del padre (ADR-004).
 *
 * El padre no puede dar más de lo que le queda: si pide más, el hijo recibe el
 * restante; si el padre ya se pasó, el hijo recibe cero, que es «no gastes». Un
 * padre sin límite (`null`) no acota. El restante se redondea a la diezmilésima de
 * euro, que es la precisión con la que se cobra el uso de los modelos, para que una
 * resta en coma flotante no deje un presupuesto de 0,30000000000000004 €.
 */
export function acotarPresupuesto(
  pedidoEuros: number,
  restanteDelPadreEuros: number | null,
): number {
  if (restanteDelPadreEuros === null) return pedidoEuros;
  const cota = Math.max(0, Math.round(restanteDelPadreEuros * 10_000) / 10_000);
  return Math.min(pedidoEuros, cota);
}

export function resolverRespaldo(politica: PoliticaRespaldo): Respaldo {
  switch (politica) {
    case 'seguir_sin_ello':
      return {
        continua: true,
        escala: false,
        motivo: 'La delegación venció el plazo: el padre sigue sin el resultado.',
      };
    case 'aparcar':
      return {
        continua: false,
        escala: false,
        motivo: 'La delegación venció el plazo: la tarea queda aparcada.',
      };
    case 'escalar_a_persona':
      return {
        continua: false,
        escala: true,
        motivo: 'La delegación venció el plazo: se escala a una persona para que decida.',
      };
  }
}
