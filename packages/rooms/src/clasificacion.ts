/**
 * Paso de clasificación con modelo para las salas (sala de departamento v2).
 *
 * El moderador y el Director dan un paso de modelo que solo clasifica: elige entre
 * identificadores que ya están en la lista que recibe, nunca redacta ni ejecuta.
 * Este módulo es lo común a los dos: el puerto que ofrece el trabajador (sobre el
 * enrutador de `@aiw/models`, sin que este paquete conozca ningún proveedor) y el
 * reintento acotado con validación estricta del esquema.
 *
 * Un fallo, un tiempo agotado o una salida que no cumple el esquema no bloquean la
 * sala: devuelven `no_disponible` con su motivo y quien llama cae en el silencio o
 * la aclaración que daría sin modelo (docs/specs/sala-departamento-moderador-modelo.md,
 * decisión 7). No hay respaldo de otro proveedor: es el guardián de coste de sala.
 */
import type { z } from 'zod';

/** Intentos por clasificación: la llamada y un reintento si falla o no cumple el esquema. */
export const INTENTOS_DE_CLASIFICACION = 2;

export interface PeticionDeClasificacion<T> {
  /** Prompt de sistema versionado, tal cual está en el dato. */
  sistema: string;
  /** Lo que ve el modelo: un JSON con el mensaje y la lista cerrada de candidatos. */
  usuario: string;
  /** Esquema estricto de la salida, con los identificadores como enumeración cerrada. */
  esquema: z.ZodType<T>;
}

export interface RespuestaDeClasificacion {
  /** Salida sin validar: la valida `clasificar` contra el esquema de la petición. */
  salida: unknown;
  /** Coste real de la llamada con la tarifa vigente del tenant. 0 en el proveedor de prueba. */
  costeEuros: number;
  modelo: string;
}

/**
 * Lo que instala el trabajador. Lanza si no hay modelo disponible (proveedor sin
 * elegir, sin tarifa, error de transporte, rechazo del clasificador).
 */
export type PuertoDeClasificacion = <T>(
  peticion: PeticionDeClasificacion<T>,
) => Promise<RespuestaDeClasificacion>;

export type ResultadoDeClasificacion<T> =
  | { tipo: 'ok'; salida: T; costeEuros: number; llamadas: number; modelo: string }
  | { tipo: 'no_disponible'; motivo: string; costeEuros: number; llamadas: number };

function descripcion(error: unknown): string {
  return error instanceof Error ? error.message : 'error desconocido';
}

/**
 * Llama al puerto hasta `INTENTOS_DE_CLASIFICACION` veces y valida la salida contra
 * el esquema. Un identificador fuera de la lista es un fallo de esquema, no una
 * intervención: la salida se descarta. El coste de cada llamada que llegó a hacerse
 * se suma, también el de las que no pasaron el esquema.
 */
export async function clasificar<T>(
  puerto: PuertoDeClasificacion,
  peticion: PeticionDeClasificacion<T>,
): Promise<ResultadoDeClasificacion<T>> {
  let costeEuros = 0;
  let llamadas = 0;
  let ultimo = 'sin intentos';

  for (let intento = 1; intento <= INTENTOS_DE_CLASIFICACION; intento += 1) {
    let respuesta: RespuestaDeClasificacion;
    try {
      respuesta = await puerto(peticion);
    } catch (error) {
      ultimo = descripcion(error);
      continue;
    }
    llamadas += 1;
    costeEuros += respuesta.costeEuros;

    const validada = peticion.esquema.safeParse(respuesta.salida);
    if (validada.success) {
      return { tipo: 'ok', salida: validada.data, costeEuros, llamadas, modelo: respuesta.modelo };
    }
    ultimo = `la salida del modelo no cumple el esquema (${validada.error.issues
      .map((i) => i.message)
      .join('; ')})`;
  }

  return {
    tipo: 'no_disponible',
    motivo: `el paso de modelo no estuvo disponible (${ultimo})`,
    costeEuros,
    llamadas,
  };
}
