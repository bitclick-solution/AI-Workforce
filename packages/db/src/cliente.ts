/**
 * Conexión a PostgreSQL y fijación del tenant de la sesión.
 *
 * Toda consulta de la aplicación corre con el rol `aiw_app` y con `aiw.tenant_id`
 * fijado: las políticas de RLS leen ese ajuste. Sin ajuste, las políticas no dejan
 * ver ninguna fila, que es el comportamiento seguro por defecto.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { AJUSTE_TENANT } from './columnas.js';

export type BaseDeDatos = PostgresJsDatabase<Record<string, never>>;

export interface OpcionesConexion {
  /** Cadena de conexión. Nunca se escribe en código ni en registros: llega del entorno. */
  url: string;
  /** Rol con el que corre la aplicación. `undefined` mantiene el rol de la conexión. */
  rolAplicacion?: string | undefined;
  maxConexiones?: number | undefined;
}

export interface Conexion {
  db: BaseDeDatos;
  cliente: postgres.Sql;
  cerrar: () => Promise<void>;
}

/** Nombre del rol de aplicación que crea la migración inicial. */
export const ROL_APLICACION = 'aiw_app';

/** Nombre del rol propietario del esquema, el único que migra. */
export const ROL_MIGRADOR = 'aiw_migrador';

export function crearConexion(opciones: OpcionesConexion): Conexion {
  const cliente = postgres(opciones.url, {
    max: opciones.maxConexiones ?? 10,
    onnotice: () => undefined,
    ...(opciones.rolAplicacion === undefined
      ? {}
      : { connection: { role: opciones.rolAplicacion } }),
  });
  return {
    db: drizzle(cliente),
    cliente,
    cerrar: async () => {
      await cliente.end({ timeout: 5 });
    },
  };
}

/**
 * Ejecuta el cuerpo dentro de una transacción con el tenant fijado.
 *
 * `set_config(..., true)` es local a la transacción: al terminar, el ajuste se
 * deshace y la conexión vuelve al estado sin tenant. Así una conexión reutilizada
 * de un pool nunca arrastra el tenant de la petición anterior.
 */
export async function conTenant<T>(
  cliente: postgres.Sql,
  tenantId: string,
  cuerpo: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return cliente.begin(async (tx) => {
    await tx`select set_config(${AJUSTE_TENANT}, ${tenantId}, true)`;
    return cuerpo(tx);
  }) as Promise<T>;
}

/** Igual que `conTenant` pero además cambia al rol indicado dentro de la transacción. */
export async function conTenantYRol<T>(
  cliente: postgres.Sql,
  tenantId: string,
  rol: string,
  cuerpo: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return cliente.begin(async (tx) => {
    await tx.unsafe(`set local role ${identificadorSeguro(rol)}`);
    await tx`select set_config(${AJUSTE_TENANT}, ${tenantId}, true)`;
    return cuerpo(tx);
  }) as Promise<T>;
}

/** Los identificadores no se parametrizan: se validan antes de interpolarse. */
export function identificadorSeguro(nombre: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(nombre)) {
    throw new Error(`Identificador no válido: ${nombre}`);
  }
  return nombre;
}

/** Comprueba que la extensión pgvector y la función de UUID v7 están disponibles. */
export async function comprobarCimientos(cliente: postgres.Sql): Promise<void> {
  const [fila] = await cliente<{ vector: boolean; uuid: boolean }[]>`
    select
      exists (select 1 from pg_extension where extname = 'vector') as vector,
      exists (select 1 from pg_proc where proname = 'uuid_generar_v7') as uuid
  `;
  if (!fila?.vector) throw new Error('Falta la extensión pgvector: aplica la migración inicial.');
  if (!fila.uuid) throw new Error('Falta uuid_generar_v7(): aplica la migración inicial.');
}

export { sql };
