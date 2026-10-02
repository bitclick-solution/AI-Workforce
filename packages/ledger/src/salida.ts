/**
 * Lectura y marcado de la salida transaccional de eventos (`evento_salida`).
 *
 * Quien escribe un evento vive junto al dato que lo origina —`solicitarAprobacion`
 * en `aprobacion.ts`, `emitirEventoDeContador` en `contador.ts`— en la misma
 * transacción que ese dato: si se deshace, el evento se deshace con ella. Este
 * módulo es para quien lo consume después: leer los pendientes de un destino y
 * marcar cada uno publicado o fallido. Genérico a propósito, no solo para
 * aprobaciones: es el primer consumidor real de `evento_salida`, y fija el
 * contrato que puede reutilizar el día que el panel tenga el suyo.
 */
import type postgres from 'postgres';

export interface EventoDeSalida {
  id: string;
  tipo: string;
  carga: unknown;
  intentos: number;
}

/** Los pendientes de un destino, los más antiguos primero. No los marca. */
export async function eventosPendientes(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  destino: string,
  limite = 20,
): Promise<EventoDeSalida[]> {
  const filas = await tx<{ id: string; tipo: string; carga: unknown; intentos: number }[]>`
    select id, tipo, carga, intentos from evento_salida
    where tenant_id = ${tenantId} and destino = ${destino} and estado = 'pendiente'
    order by creado_en asc
    limit ${limite}
  `;
  return filas;
}

/** El evento se publicó: no se vuelve a leer como pendiente. */
export async function marcarEventoPublicado(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  eventoId: string,
): Promise<void> {
  await tx`
    update evento_salida
    set estado = 'publicado', publicado_en = clock_timestamp(), intentos = intentos + 1
    where tenant_id = ${tenantId} and id = ${eventoId}
  `;
}

/**
 * El evento falló: queda `fallido`, con el motivo, y no se reintenta solo.
 *
 * `enviarSolicitud` (y quien más consuma esto) ya agota sus propios reintentos
 * antes de lanzar, así que un reintento automático aquí encima sería un reintento
 * doble. Reintentar un evento fallido es una acción explícita de quien opera, no
 * de este módulo.
 */
export async function marcarEventoFallido(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  eventoId: string,
  error: string,
): Promise<void> {
  await tx`
    update evento_salida
    set estado = 'fallido', intentos = intentos + 1, ultimo_error = ${error}
    where tenant_id = ${tenantId} and id = ${eventoId}
  `;
}
