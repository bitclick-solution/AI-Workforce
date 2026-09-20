/**
 * Un secreto que no se imprime.
 *
 * La definición de hecho pide que ninguna credencial acabe en un registro, y la
 * forma más común de que acabe ahí no es un `console.log` a la clave: es un
 * `JSON.stringify(configuracion)` en un mensaje de error, o el volcado de un objeto
 * al depurar. Envolver el valor y sobrescribir las tres formas de convertirlo en
 * texto —`toString`, `toJSON` y el inspector de Node— convierte ese descuido en
 * imposible; para usar el valor hay que pedirlo a propósito con `revelar()`.
 */
const OCULTO = '«secreto oculto»';

export class Secreto {
  readonly #valor: string;
  /** Para qué sirve. Se puede imprimir: es el nombre, no el valor. */
  readonly nombre: string;

  constructor(valor: string, nombre: string) {
    this.#valor = valor;
    this.nombre = nombre;
  }

  /** Devuelve el valor. Úsalo en el borde, nunca para componer un mensaje. */
  revelar(): string {
    return this.#valor;
  }

  get vacio(): boolean {
    return this.#valor.length === 0;
  }

  get longitud(): number {
    return this.#valor.length;
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
