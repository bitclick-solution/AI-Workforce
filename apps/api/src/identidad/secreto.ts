/**
 * Un secreto que no se imprime.
 *
 * Misma idea que el de `apps/channels`: `toString`, `toJSON` y el inspector de Node
 * devuelven un texto fijo, y para usar el valor hay que pedirlo con `revelar()`.
 * Una aplicación no importa otra, así que aquí vive una copia mínima; moverla a un
 * paquete compartido queda propuesto como rebanada.
 */
const OCULTO = '«secreto oculto»';

export class Secreto {
  readonly #valor: string;
  readonly nombre: string;

  constructor(valor: string, nombre: string) {
    this.#valor = valor;
    this.nombre = nombre;
  }

  /** Devuelve el valor. Úsalo en el borde, nunca para componer un mensaje. */
  revelar(): string {
    return this.#valor;
  }

  toString(): string {
    return OCULTO;
  }

  toJSON(): string {
    return OCULTO;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return OCULTO;
  }
}

export const TEXTO_OCULTO = OCULTO;
