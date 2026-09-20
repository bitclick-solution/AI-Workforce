/**
 * Dobles que fallan. Solo para pruebas: no entran en el camino de producción.
 *
 * Existen aparte para que `CorreoEnMemoria` y `SenalEnMemoria` no lleven dentro un
 * interruptor de «falla las dos primeras veces»: un proveedor de desarrollo con
 * modos de fallo termina usándose en producción por descuido.
 */
import type {
  CargaSenalDecision,
  CorreoSaliente,
  DestinoDeFlujo,
  PuertoDeCorreo,
  PuertoDeSenal,
  ResultadoEnvio,
} from '@aiw/domain';

export interface OpcionesFallo {
  /** Cuántos intentos fallan antes de funcionar. `Infinity` para que no funcione. */
  falla: number;
  mensaje?: string;
}

export class CorreoQueFalla implements PuertoDeCorreo {
  readonly enviados: CorreoSaliente[] = [];
  intentos = 0;
  readonly #falla: number;
  readonly #mensaje: string;

  constructor(opciones: OpcionesFallo) {
    this.#falla = opciones.falla;
    this.#mensaje = opciones.mensaje ?? 'el servidor de correo no responde';
  }

  async enviar(correo: CorreoSaliente): Promise<ResultadoEnvio> {
    this.intentos += 1;
    if (this.intentos <= this.#falla) throw new Error(this.#mensaje);
    this.enviados.push(correo);
    return Promise.resolve({ id: `prueba-${this.enviados.length}`, proveedor: 'prueba' });
  }
}

export class SenalQueFalla implements PuertoDeSenal {
  readonly entregadas: { destino: DestinoDeFlujo; carga: CargaSenalDecision }[] = [];
  intentos = 0;
  readonly #falla: number;
  readonly #mensaje: string;

  constructor(opciones: OpcionesFallo) {
    this.#falla = opciones.falla;
    this.#mensaje = opciones.mensaje ?? 'el flujo no acepta la señal';
  }

  async entregar(destino: DestinoDeFlujo, carga: CargaSenalDecision): Promise<void> {
    this.intentos += 1;
    if (this.intentos <= this.#falla) throw new Error(this.#mensaje);
    this.entregadas.push({ destino, carga });
    return Promise.resolve();
  }
}

/** Espera de mentira: las pruebas de reintentos no duermen. */
export async function sinDormir(): Promise<void> {
  return Promise.resolve();
}
