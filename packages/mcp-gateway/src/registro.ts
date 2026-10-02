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

/**
 * Cómo se llega a un servidor MCP. El secreto es nulo si el conector no lleva.
 *
 * `confirmacion` solo llega en la conexión efímera de una escritura ya aprobada
 * (ADR-031): es la credencial que permite confirmar la escritura en el sistema de
 * destino, y ninguna otra conexión la recibe.
 */
export type FabricaDeServidor = (
  secreto: Secreto | null,
  confirmacion?: Secreto,
) => Promise<ConexionMcp>;

export interface OpcionesDeRegistro {
  /**
   * Referencia de secreto de la credencial de confirmación del conector, distinta
   * de `conector.referencia_secreto`. Sin ella, el conector no tiene confirmación
   * propia y sus escrituras aprobadas usan la conexión normal.
   */
  referenciaConfirmacion?: string | undefined;
}

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
  readonly #referenciasDeConfirmacion = new Map<string, string>();

  /** Registra o sustituye la fábrica de un conector. Sustituir es lo normal al probar. */
  registrar(
    nombreConector: string,
    fabrica: FabricaDeServidor,
    opciones: OpcionesDeRegistro = {},
  ): this {
    if (nombreConector.trim() === '') {
      throw new Error('Un conector sin nombre no se puede registrar.');
    }
    this.#fabricas.set(nombreConector, fabrica);
    const referencia = opciones.referenciaConfirmacion?.trim() ?? '';
    if (referencia === '') this.#referenciasDeConfirmacion.delete(nombreConector);
    else this.#referenciasDeConfirmacion.set(nombreConector, referencia);
    return this;
  }

  /** Referencia de la credencial de confirmación del conector, si tiene. */
  referenciaConfirmacion(nombreConector: string): string | undefined {
    return this.#referenciasDeConfirmacion.get(nombreConector);
  }

  tiene(nombreConector: string): boolean {
    return this.#fabricas.has(nombreConector);
  }

  get nombres(): readonly string[] {
    return [...this.#fabricas.keys()];
  }

  /** Abre una conexión nueva. El gateway decide si la reutiliza o la cierra. */
  async abrir(
    nombreConector: string,
    secreto: Secreto | null,
    confirmacion?: Secreto,
  ): Promise<ConexionMcp> {
    const fabrica = this.#fabricas.get(nombreConector);
    if (!fabrica) throw new ConectorNoRegistrado(nombreConector, this.nombres);
    return confirmacion === undefined ? fabrica(secreto) : fabrica(secreto, confirmacion);
  }
}
