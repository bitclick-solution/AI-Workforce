/**
 * Coste por tarea completada a Langfuse (ADR-018): "el coste se mide por tarea
 * completada, por puesto y modelo, no por llamada".
 *
 * Sin credenciales reales en el código: `LANGFUSE_PUBLIC_KEY` y
 * `LANGFUSE_SECRET_KEY` llegan por entorno. Si faltan, se usa un observador nulo que
 * no manda nada y no rompe la tarea: perder la traza de coste no puede tirar abajo
 * el bucle del agente. El runbook de `docs/runbooks/modelos-funciones-ausentes.md`
 * trae los pasos para activar las credenciales reales.
 */
import type { TokensDeUso } from '../puerto.js';

export interface EventoCosteDeTarea {
  tareaRaizId: string;
  puestoId: string;
  versionPuestoId: string;
  modelo: string;
  plataforma: string;
  tokens: TokensDeUso;
  costeEuros: number;
  completadaEn?: Date | undefined;
}

export interface PuertoDeObservabilidadDeCoste {
  registrarCosteDeTarea(evento: EventoCosteDeTarea): Promise<void>;
}

/** No manda nada. Es lo que se usa mientras no hay credenciales de Langfuse. */
export function observadorNulo(): PuertoDeObservabilidadDeCoste {
  return {
    async registrarCosteDeTarea() {
      // Intencionadamente vacío: sin credenciales, no hay traza de coste que mandar.
    },
  };
}

/** Observador en memoria: para pruebas que quieren comprobar qué se habría mandado. */
export function observadorEnMemoria(): PuertoDeObservabilidadDeCoste & {
  eventos: EventoCosteDeTarea[];
} {
  const eventos: EventoCosteDeTarea[] = [];
  return {
    eventos,
    async registrarCosteDeTarea(evento) {
      eventos.push(evento);
    },
  };
}

export interface OpcionesLangfuse {
  claveBase64: string;
  baseUrl: string;
  fetch: typeof fetch;
}

function aIngestionLangfuse(evento: EventoCosteDeTarea): unknown {
  const completadaEn = (evento.completadaEn ?? new Date()).toISOString();
  return {
    batch: [
      {
        id: `${evento.tareaRaizId}:${evento.modelo}:${evento.plataforma}`,
        type: 'generation-create',
        timestamp: completadaEn,
        body: {
          traceId: evento.tareaRaizId,
          name: 'tarea.completada',
          model: evento.modelo,
          startTime: completadaEn,
          endTime: completadaEn,
          usageDetails: {
            input: evento.tokens.entrada,
            output: evento.tokens.salida,
            input_cached: evento.tokens.entradaCache ?? 0,
          },
          costDetails: { total: evento.costeEuros },
          metadata: {
            puestoId: evento.puestoId,
            versionPuestoId: evento.versionPuestoId,
            plataforma: evento.plataforma,
          },
        },
      },
    ],
  };
}

/**
 * Observador real: manda el coste a la API de ingestión de Langfuse. `opciones.fetch`
 * se inyecta para que las pruebas apunten a un servidor propio sin credenciales
 * reales; en producción es el `fetch` global de Node 22.
 */
export function crearObservadorLangfuse(opciones: OpcionesLangfuse): PuertoDeObservabilidadDeCoste {
  return {
    async registrarCosteDeTarea(evento) {
      const respuesta = await opciones.fetch(`${opciones.baseUrl}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${opciones.claveBase64}`,
        },
        body: JSON.stringify(aIngestionLangfuse(evento)),
      });
      if (!respuesta.ok) {
        throw new Error(
          `Langfuse rechazó el coste de la tarea ${evento.tareaRaizId}: ${respuesta.status} ${await respuesta.text()}`,
        );
      }
    },
  };
}

export type Entorno = Record<string, string | undefined>;

/**
 * Construye el observador desde el entorno: Langfuse real si están las dos claves,
 * el nulo si no. Nunca lanza por falta de credenciales: es una traza de
 * observabilidad, no una escritura de negocio.
 */
export function observadorDesdeEntorno(
  entorno: Entorno = process.env,
): PuertoDeObservabilidadDeCoste {
  const publica = entorno['LANGFUSE_PUBLIC_KEY'];
  const secreta = entorno['LANGFUSE_SECRET_KEY'];
  if (!publica || !secreta) return observadorNulo();

  const baseUrl = entorno['LANGFUSE_BASE_URL'] ?? 'https://cloud.langfuse.com';
  const claveBase64 = Buffer.from(`${publica}:${secreta}`, 'utf8').toString('base64');
  return crearObservadorLangfuse({ claveBase64, baseUrl, fetch });
}
