/**
 * Secretos del conector: se resuelven aquí y no salen de aquí.
 *
 * Zona crítica: gateway MCP y credenciales. La frontera de arquitectura dice que
 * «las credenciales nunca entran en el contexto del modelo», y una frontera que
 * solo existe en la cabeza de quien escribe el código se cruza el día que alguien
 * añade una traza. Así que el valor no viaja como `string`: viaja dentro de un
 * objeto que no sabe imprimirse.
 *
 * `Secreto` guarda el valor en un campo privado de instancia y sobrescribe las tres
 * puertas por las que un valor se escapa a un registro: `toString`, `toJSON` y la
 * inspección de Node, que es la que usan `console.log` y la mayoría de los
 * registradores. Para leerlo de verdad hay que llamar a `revelar()`, que se busca
 * en una revisión con una sola orden.
 */
import { inspect } from 'node:util';

/** Lo que se ve en cualquier registro, traza o mensaje de error. */
export const MARCA_OCULTA = '«secreto oculto»';

export class Secreto {
  readonly #valor: string;
  /** De dónde salió, p. ej. `env:DEMO_CONECTOR_SECRETO`. Esto sí se puede registrar. */
  readonly referencia: string;

  constructor(referencia: string, valor: string) {
    if (referencia.trim() === '') throw new Error('Un secreto sin referencia no se puede auditar.');
    this.referencia = referencia;
    this.#valor = valor;
  }

  /** Única forma de leer el valor. Solo lo llama quien abre la conexión al conector. */
  revelar(): string {
    return this.#valor;
  }

  /** Cierto cuando la referencia existía pero no había valor detrás. */
  get vacio(): boolean {
    return this.#valor === '';
  }

  toString(): string {
    return MARCA_OCULTA;
  }

  toJSON(): string {
    return MARCA_OCULTA;
  }

  [inspect.custom](): string {
    return MARCA_OCULTA;
  }
}

export interface ResolvedorDeSecretos {
  /** Resuelve una `conector.referencia_secreto`. Lanza si el esquema no se conoce. */
  resolver(referencia: string): Promise<Secreto>;
}

/** Esquema de referencia que resuelve variables de entorno del proceso del gateway. */
export const ESQUEMA_ENTORNO = 'env:';

export class ReferenciaDeSecretoNoResoluble extends Error {
  constructor(referencia: string, detalle: string) {
    super(`No se puede resolver la referencia de secreto «${referencia}»: ${detalle}`);
    this.name = 'ReferenciaDeSecretoNoResoluble';
  }
}

/**
 * Resuelve `env:NOMBRE` contra el entorno del proceso.
 *
 * Es el resolvedor de desarrollo y de la integración continua. En producción el
 * esquema será el del gestor de secretos, y lo único que cambia es esta función:
 * ni el gateway ni el bucle del agente saben de dónde vino el valor.
 */
export function resolvedorDeEntorno(
  entorno: Record<string, string | undefined> = process.env,
): ResolvedorDeSecretos {
  return {
    resolver(referencia) {
      if (!referencia.startsWith(ESQUEMA_ENTORNO)) {
        throw new ReferenciaDeSecretoNoResoluble(
          referencia,
          `este resolvedor solo entiende el esquema «${ESQUEMA_ENTORNO}».`,
        );
      }
      const nombre = referencia.slice(ESQUEMA_ENTORNO.length);
      if (nombre.trim() === '') {
        throw new ReferenciaDeSecretoNoResoluble(referencia, 'falta el nombre de la variable.');
      }
      const valor = entorno[nombre];
      if (valor === undefined) {
        throw new ReferenciaDeSecretoNoResoluble(
          referencia,
          `la variable ${nombre} no está definida en el entorno del gateway.`,
        );
      }
      return Promise.resolve(new Secreto(referencia, valor));
    },
  };
}
