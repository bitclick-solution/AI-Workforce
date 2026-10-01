/**
 * Confirmación del borrador: la decisión de Jesús queda detrás de esta interfaz.
 *
 * Toda escritura de Factusol MCP es un borrador que caduca a los 30 minutos y que
 * alguien confirma con `confirmar_operacion`. El adaptador **nunca** llama a
 * `confirmar_operacion`: el token del agente no lleva el scope `confirmar`.
 *
 * - Opción A: el adaptador deja el borrador y una persona lo confirma en el panel
 *   de Factusol. Es la que está construida.
 * - Opción B (la que recomienda la dirección): tras la aprobación N1 el gateway
 *   confirma con un token `confirmar` que solo guarda él, solo el borrador
 *   aprobado y tras comprobar que su contenido coincide con la carga aprobada.
 *   Vive en `packages/mcp-gateway` (zona crítica) y no se construye en esta
 *   rebanada: seleccionarla hoy falla al arrancar, para que un borrador no
 *   caduque sin que nadie lo confirme.
 */
import { ErrorConector } from './errores.js';

export interface BorradorDeNota {
  readonly draftId: string;
  readonly clienteCodigo: string;
  readonly facturaId: string;
  /** Lo que el borrador deja en `observaciones`: lo que había más la línea nueva. */
  readonly observaciones: string;
}

export interface ResultadoDeConfirmacion {
  readonly estado: 'pendiente';
  readonly confirma: 'persona_en_el_panel' | 'gateway';
}

export interface ConfirmadorDeBorrador {
  readonly opcion: 'A' | 'B';
  /** Se llama con el borrador ya creado. No confirma nada. */
  alCrearBorrador(borrador: BorradorDeNota): Promise<ResultadoDeConfirmacion>;
}

/** Opción A: el borrador queda pendiente y lo confirma una persona en el panel. */
export const confirmacionPorPersona: ConfirmadorDeBorrador = {
  opcion: 'A',
  alCrearBorrador: () => Promise.resolve({ estado: 'pendiente', confirma: 'persona_en_el_panel' }),
};

export function elegirConfirmador(opcion: string | undefined): ConfirmadorDeBorrador {
  const valor = (opcion ?? 'A').trim().toUpperCase();
  if (valor === 'A') return confirmacionPorPersona;
  if (valor === 'B') {
    throw new ErrorConector(
      'invalido',
      'FACTUSOL_CONFIRMACION=B necesita la rebanada del gateway que confirma con el token «confirmar»: aún no existe. Usa A.',
    );
  }
  throw new ErrorConector('invalido', 'FACTUSOL_CONFIRMACION admite solo A o B.');
}
