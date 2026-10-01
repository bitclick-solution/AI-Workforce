/**
 * Activación del puesto de Cobros de Bitclick (ADR-015, criterio de hecho 5 y 6).
 *
 * La siembra deja el puesto `en_prueba` a propósito: ADR-015 dice que «en prueba»
 * es operativo, no declarativo, y que ninguna escritura sale al mundo mientras lo
 * esté (`packages/domain/src/politicas.ts` la simula). El camino feliz del
 * runbook —aprobar el recordatorio por correo y que la nota se escriba de verdad
 * en Odoo— solo existe con el puesto `activo`.
 *
 * No hay en el repositorio ningún camino de ciclo de vida que mueva un puesto de
 * `en_prueba` a `activo`: este módulo es el mínimo que hace falta, con su propia
 * entrada en el libro de auditoría. Solo mueve este estado; no toca el nivel de
 * autonomía por clase de acción (ADR-015: son dos palancas distintas, con una
 * sola fuente de verdad cada una).
 */
import { conTenant } from '@aiw/db';
import { anotar } from '@aiw/ledger';
import type postgres from 'postgres';

import type { EstadoBitclick } from './estado-local.js';

/** Acción del libro para esta activación. Se añade, no se renombra (igual que `ACCIONES` de aprobación). */
export const ACCION_PUESTO_ACTIVADO = 'bitclick.puesto.activado';

export interface ResultadoActivacion {
  /** `false` cuando el puesto ya estaba activo (o en otro estado) y no se tocó nada. */
  activado: boolean;
  estadoPrevio: string;
}

/**
 * Pasa el puesto de Cobros de `en_prueba` a `activo`. Segura de repetir: si ya
 * está activo —o en cualquier estado que no sea `en_prueba`— no toca nada y lo
 * dice, en vez de forzar una transición que no le corresponde a este guion.
 */
export async function activarPuestoDeCobros(
  cliente: postgres.Sql,
  estado: EstadoBitclick,
): Promise<ResultadoActivacion> {
  return conTenant(cliente, estado.tenantId, async (tx) => {
    const [fila] = await tx<{ estado: string }[]>`
      select estado::text as estado from puesto
      where tenant_id = ${estado.tenantId} and id = ${estado.puestoId}
    `;
    if (fila === undefined) {
      throw new Error(`El puesto ${estado.puestoId} no existe en el tenant ${estado.tenantId}.`);
    }
    const estadoPrevio = fila.estado;
    if (estadoPrevio !== 'en_prueba') {
      return { activado: false, estadoPrevio };
    }

    await tx`
      update puesto set estado = 'activo'
      where tenant_id = ${estado.tenantId} and id = ${estado.puestoId}
    `;
    await anotar(tx, estado.tenantId, {
      actorTipo: 'persona',
      actorId: estado.personaId,
      puestoId: estado.puestoId,
      versionPuestoId: estado.versionPuestoId,
      accion: ACCION_PUESTO_ACTIVADO,
      resultado: 'exito',
      datosReferenciados: [{ tipo: 'puesto', id: estado.puestoId }],
    });
    return { activado: true, estadoPrevio };
  });
}
