/**
 * Reintentos con espera creciente.
 *
 * El correo y la señal salen de este proceso hacia un servidor que puede no estar:
 * sin reintentos, un SMTP que tarda dos segundos de más deja una aprobación que
 * nadie va a ver nunca. Cada intento fallido se avisa por `alFallar`, que es donde
 * quien llama anota la entrada de auditoría: un reintento es otra acción, no un
 * retoque de la anterior.
 *
 * El reloj y la espera se inyectan para que las pruebas no duerman de verdad.
 */
export interface OpcionesReintento {
  /** Intentos en total, contando el primero. */
  intentos?: number | undefined;
  /** Espera antes del segundo intento. Los siguientes la multiplican por `factor`. */
  retardoMs?: number | undefined;
  factor?: number | undefined;
  /** Devuelve `true` cuando el error no va a cambiar por reintentar. */
  esDefinitivo?: ((error: unknown) => boolean) | undefined;
  alFallar?:
    | ((error: unknown, intento: number, quedanIntentos: boolean) => Promise<void> | void)
    | undefined;
  dormir?: ((ms: number) => Promise<void>) | undefined;
}

export interface ResultadoIntentos<T> {
  valor: T;
  /** En qué intento salió bien. Se anota junto al resultado. */
  intentos: number;
}

/** Error que no mejora por reintentar: dirección mal escrita, credencial rechazada. */
export class ErrorDefinitivo extends Error {
  constructor(mensaje: string, opciones?: ErrorOptions) {
    super(mensaje, opciones);
    this.name = 'ErrorDefinitivo';
  }
}

export function dormirDeVerdad(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

export async function reintentar<T>(
  operacion: (intento: number) => Promise<T>,
  opciones: OpcionesReintento = {},
): Promise<ResultadoIntentos<T>> {
  const total = Math.max(1, Math.floor(opciones.intentos ?? 3));
  const retardo = opciones.retardoMs ?? 500;
  const factor = opciones.factor ?? 2;
  const esDefinitivo = opciones.esDefinitivo ?? ((error) => error instanceof ErrorDefinitivo);
  const dormir = opciones.dormir ?? dormirDeVerdad;

  let ultimo: unknown;
  for (let intento = 1; intento <= total; intento += 1) {
    try {
      return { valor: await operacion(intento), intentos: intento };
    } catch (error) {
      ultimo = error;
      const definitivo = esDefinitivo(error);
      const quedan = !definitivo && intento < total;
      await opciones.alFallar?.(error, intento, quedan);
      if (!quedan) break;
      await dormir(retardo * Math.pow(factor, intento - 1));
    }
  }
  throw ultimo;
}

/** Texto corto y seguro de un error, para anotar. Nunca incluye el token ni la clave. */
export function textoDeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : 'error desconocido';
}
