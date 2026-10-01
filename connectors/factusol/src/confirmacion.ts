/**
 * Confirmación del borrador (ADR-031, decisión de Jesús del 1-10).
 *
 * Toda escritura de Factusol MCP es un borrador que caduca a los 30 minutos y que
 * solo un token con el scope `confirmar` puede confirmar con `confirmar_operacion`.
 * La aprobación N1 de la plataforma es la única confirmación humana.
 *
 * - **B (por defecto).** El gateway lanza este proceso para una escritura ya aprobada y
 *   le entrega, además del token del agente, el de confirmación en una variable
 *   distinta. Aquí se confirma solo el borrador recién creado, y solo si su diff dice
 *   que cambia únicamente `observaciones` y que el valor nuevo es el actual más la
 *   nota aprobada. El token de confirmación se usa en un único cliente, que solo
 *   llama a `confirmar_operacion`: ni las lecturas ni el resto del agente lo ven.
 * - **A (transitoria, sin gateway).** El adaptador deja el borrador y una persona lo
 *   confirma en el panel de Factusol.
 */
import { leerEstado, type CambioDeCampo } from './borrador.js';
import { HERRAMIENTAS_FACTUSOL, type ClienteFactusol } from './cliente.js';
import { ErrorConector } from './errores.js';

/** Única herramienta que usa el cliente de confirmación. No está en `HERRAMIENTAS_FACTUSOL`. */
export const OPERACION_CONFIRMAR = 'confirmar_operacion';

export interface BorradorDeNota {
  readonly draftId: string;
  readonly clienteCodigo: string;
  readonly facturaId: string;
  /** Lo que el borrador deja en `observaciones`: lo que había más la línea nueva. */
  readonly observaciones: string;
  /** La línea aprobada, sola. */
  readonly linea: string;
  /** Cambios del borrador por campo, tal como los devolvió Factusol MCP. */
  readonly cambios: ReadonlyMap<string, CambioDeCampo>;
}

export interface ResultadoDeConfirmacion {
  readonly estado: 'pendiente' | 'confirmado';
  readonly confirma: 'persona_en_el_panel' | 'gateway';
}

export interface ConfirmadorDeBorrador {
  readonly opcion: 'A' | 'B';
  /** Antes de crear ningún borrador: sin lo necesario para confirmar, falla sin dejar nada. */
  antesDeEscribir(): void;
  /** Con el borrador ya creado. */
  alCrearBorrador(borrador: BorradorDeNota): Promise<ResultadoDeConfirmacion>;
  /** Cancela el borrador en Factusol. Nunca confirma. */
  cancelar(draftId: string): Promise<void>;
}

/** La línea nueva se añade al final de lo que había, sin borrar nada. */
export function observacionesTrasAnotar(actual: string, linea: string): string {
  return actual.trim() === '' ? linea : `${actual.replace(/\s+$/, '')}\n${linea}`;
}

/**
 * El borrador solo se confirma si lo único que cambia es `observaciones` y el valor
 * nuevo es el actual más la nota aprobada. Cualquier otra cosa, incluido un diff que no
 * se pueda leer, es `invalido`.
 */
export function comprobarCoincidencia(borrador: BorradorDeNota): void {
  const cambiados = [...borrador.cambios.entries()].filter(([, c]) => c.actual !== c.nuevo);
  if (borrador.cambios.size === 0) {
    throw new ErrorConector(
      'invalido',
      'El borrador no trae diff legible: no se confirma lo que no se puede comprobar.',
    );
  }
  const [unico] = cambiados;
  if (cambiados.length !== 1 || unico === undefined || unico[0] !== 'observaciones') {
    throw new ErrorConector(
      'invalido',
      'El borrador cambia algo más que «observaciones» o no cambia nada: no coincide con lo aprobado.',
    );
  }
  const esperado = observacionesTrasAnotar(unico[1].actual, borrador.linea);
  if (unico[1].nuevo !== esperado || unico[1].nuevo !== borrador.observaciones) {
    throw new ErrorConector(
      'invalido',
      'El valor nuevo de «observaciones» no es el actual más la nota aprobada: no se confirma.',
    );
  }
}

export function confirmacionPorPersona(cliente: ClienteFactusol): ConfirmadorDeBorrador {
  return {
    opcion: 'A',
    antesDeEscribir: () => undefined,
    alCrearBorrador: () =>
      Promise.resolve({ estado: 'pendiente', confirma: 'persona_en_el_panel' }),
    cancelar: async (draftId) => {
      await cliente.llamar(HERRAMIENTAS_FACTUSOL.cancelarBorrador, { draft_id: draftId });
    },
  };
}

export interface OpcionesConfirmacionPorGateway {
  /** Cliente con el token del agente: lee el estado del borrador y lo cancela. */
  readonly cliente: ClienteFactusol;
  /** Cliente con el token `confirmar`. Ausente si el gateway no lo entregó. */
  readonly clienteConfirmar?: ClienteFactusol | undefined;
}

export function confirmacionPorGateway(
  opciones: OpcionesConfirmacionPorGateway,
): ConfirmadorDeBorrador {
  const { cliente, clienteConfirmar } = opciones;
  return {
    opcion: 'B',
    antesDeEscribir() {
      if (clienteConfirmar === undefined) {
        throw new ErrorConector(
          'no_autorizado',
          'Sin el token de confirmación no se escribe en Factusol: no se crea ningún borrador.',
        );
      }
    },
    async alCrearBorrador(borrador) {
      if (clienteConfirmar === undefined) {
        throw new ErrorConector('no_autorizado', 'Falta el token de confirmación.');
      }
      try {
        comprobarCoincidencia(borrador);
      } catch (error) {
        // Lo que no coincide con lo aprobado no se confirma ni se deja pendiente.
        await cliente
          .llamar(HERRAMIENTAS_FACTUSOL.cancelarBorrador, { draft_id: borrador.draftId })
          .catch(() => undefined);
        throw error;
      }
      await clienteConfirmar.llamar(OPERACION_CONFIRMAR, { draft_id: borrador.draftId });
      const estado = leerEstado(
        (await cliente.llamar(HERRAMIENTAS_FACTUSOL.estadoBorrador, { draft_id: borrador.draftId }))
          .estructurado,
      );
      if (estado.estado === 'ejecutado') return { estado: 'confirmado', confirma: 'gateway' };
      throw new ErrorConector(
        'temporal',
        estado.estado === 'caducado'
          ? 'El borrador caducó antes de confirmarse: se reintenta con uno nuevo.'
          : 'No se pudo verificar que Factusol escribiera el borrador: se reintenta.',
      );
    },
    cancelar: async (draftId) => {
      await cliente.llamar(HERRAMIENTAS_FACTUSOL.cancelarBorrador, { draft_id: draftId });
    },
  };
}

export type OpcionDeConfirmacion = 'A' | 'B';

export function leerOpcionDeConfirmacion(valor: string | undefined): OpcionDeConfirmacion {
  const opcion = (valor ?? 'B').trim().toUpperCase();
  if (opcion === 'A' || opcion === 'B') return opcion;
  throw new ErrorConector('invalido', 'FACTUSOL_CONFIRMACION admite solo A o B.');
}
