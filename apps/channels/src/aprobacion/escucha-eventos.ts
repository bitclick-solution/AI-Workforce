/**
 * Consume la salida transaccional de eventos para mandar el correo en cuanto se
 * crea una aprobación, sin que nadie llame a `enviarSolicitud` a mano (seguimiento
 * 2-10; ver la especificación, sección «El correo sale solo al crearse la
 * aprobación»).
 *
 * `apps/worker` no importa `apps/channels` (fronteras de arquitectura): el aviso
 * sale de `solicitarAprobacion` (`@aiw/ledger`) como una fila en `evento_salida`,
 * en la misma transacción que la aprobación, y este módulo es quien la consume.
 */
import { conTenant } from '@aiw/db';
import {
  DESTINO_EVENTO_APROBACION_CORREO,
  TIPO_EVENTO_APROBACION_CREADA,
  eventosPendientes,
  marcarEventoFallido,
  marcarEventoPublicado,
  type EventoDeSalida,
} from '@aiw/ledger';
import type postgres from 'postgres';

import type { ServicioDeAprobacion } from './servicio.js';

function aprobacionIdDe(evento: EventoDeSalida): string | undefined {
  if (evento.tipo !== TIPO_EVENTO_APROBACION_CREADA) return undefined;
  if (typeof evento.carga !== 'object' || evento.carga === null) return undefined;
  const id = (evento.carga as Record<string, unknown>)['aprobacionId'];
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** Procesa los eventos pendientes de un tenant. Devuelve cuántos se intentaron. */
export async function procesarEventosDeAprobacion(
  cliente: postgres.Sql,
  servicio: ServicioDeAprobacion,
  tenantId: string,
  limite = 20,
): Promise<number> {
  const pendientes = await conTenant(cliente, tenantId, (tx) =>
    eventosPendientes(tx, tenantId, DESTINO_EVENTO_APROBACION_CORREO, limite),
  );

  for (const evento of pendientes) {
    const aprobacionId = aprobacionIdDe(evento);
    try {
      if (!aprobacionId) {
        throw new Error(`Evento ${evento.id}: no trae un aprobacionId utilizable.`);
      }
      await servicio.enviarSolicitud(tenantId, aprobacionId);
      await conTenant(cliente, tenantId, (tx) => marcarEventoPublicado(tx, tenantId, evento.id));
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      await conTenant(cliente, tenantId, (tx) =>
        marcarEventoFallido(tx, tenantId, evento.id, mensaje),
      );
    }
  }

  return pendientes.length;
}

export interface OpcionesEscucha {
  cliente: postgres.Sql;
  servicio: ServicioDeAprobacion;
  tenantIds: readonly string[];
  /** Cada cuánto sondea. Cinco segundos basta para una demo; no es para producción a escala. */
  intervaloMs?: number;
  limite?: number;
  alFallar?: (tenantId: string, error: unknown) => void;
}

export interface EscuchaEnMarcha {
  parar: () => void;
}

/**
 * Arranca el sondeo periódico. Un tenant que falla no bloquea a los demás; el
 * temporizador sigue en marcha hasta `parar()`.
 *
 * Una vuelta en marcha salta la siguiente del mismo tenant: sin esto, un lote que
 * tarda más que `intervaloMs` deja que dos vueltas lean el mismo evento
 * `pendiente` antes de que la primera lo marque, y lo manden dos veces.
 */
export function escucharEventosDeAprobacion(opciones: OpcionesEscucha): EscuchaEnMarcha {
  const intervaloMs = opciones.intervaloMs ?? 5000;
  const alFallar = opciones.alFallar ?? (() => undefined);
  const enMarcha = new Set<string>();

  const temporizador = setInterval(() => {
    for (const tenantId of opciones.tenantIds) {
      if (enMarcha.has(tenantId)) continue;
      enMarcha.add(tenantId);
      procesarEventosDeAprobacion(opciones.cliente, opciones.servicio, tenantId, opciones.limite)
        .catch((error: unknown) => {
          alFallar(tenantId, error);
        })
        .finally(() => {
          enMarcha.delete(tenantId);
        });
    }
  }, intervaloMs);
  temporizador.unref();

  return { parar: () => clearInterval(temporizador) };
}
