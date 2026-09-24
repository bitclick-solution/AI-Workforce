/**
 * Registro de servidores MCP por conector.
 *
 * Un conector es una fila de la base (`conector`, con su tipo, su nombre y su
 * referencia de secreto) y una fábrica de transporte registrada aquí por su
 * nombre. La fila dice qué conector tiene el tenant; la fábrica dice cómo se llega
 * a él. Separarlos es lo que permite que la organización sea dato: dar de alta un
 * conector para un tenant es insertar una fila, no desplegar código.
 *
 * La fábrica recibe el secreto ya resuelto y construye el transporte con él dentro
 * —variables de entorno de un proceso hijo, cabecera de autorización de una
 * conexión HTTP—. El secreto no pasa por el gateway ni por el bucle: va del
 * resolvedor a la fábrica y ahí se queda.
 */
import type { ConexionMcp } from './herramientas.js';
import type { Secreto } from './secretos.js';

/** Cómo se llega a un servidor MCP. El secreto es nulo si el conector no lleva. */
export type FabricaDeServidor = (secreto: Secreto | null) => Promise<ConexionMcp>;

export class ConectorNoRegistrado extends Error {
  constructor(nombre: string, registrados: readonly string[]) {
    super(
      `El conector «${nombre}» no tiene servidor MCP registrado en este proceso. ` +
        `Registrados: ${registrados.length === 0 ? 'ninguno' : registrados.join(', ')}.`,
    );
    this.name = 'ConectorNoRegistrado';
  }
}

export class RegistroDeServidores {
  readonly #fabricas = new Map<string, FabricaDeServidor>();

  /** Registra o sustituye la fábrica de un conector. Sustituir es lo normal al probar. */
  registrar(nombreConector: string, fabrica: FabricaDeServidor): this {
    if (nombreConector.trim() === '') {
      throw new Error('Un conector sin nombre no se puede registrar.');
    }
    this.#fabricas.set(nombreConector, fabrica);
    return this;
  }

  tiene(nombreConector: string): boolean {
    return this.#fabricas.has(nombreConector);
  }

  get nombres(): readonly string[] {
    return [...this.#fabricas.keys()];
  }

  /** Abre una conexión nueva. El gateway decide si la reutiliza o la cierra. */
  async abrir(nombreConector: string, secreto: Secreto | null): Promise<ConexionMcp> {
    const fabrica = this.#fabricas.get(nombreConector);
    if (!fabrica) throw new ConectorNoRegistrado(nombreConector, this.nombres);
    return fabrica(secreto);
  }
}
