/**
 * Entorno de las pruebas que necesitan PostgreSQL.
 *
 * Sin `DATABASE_URL` no hay base contra la que probar: las pruebas se saltan con
 * un mensaje que dice qué falta, en vez de fallar. En la integración continua el
 * job «Base de datos» la define y todas se ejecutan.
 */
import postgres from 'postgres';

export const URL_BASE_DE_DATOS = process.env['DATABASE_URL'];

export const HAY_BASE_DE_DATOS = Boolean(URL_BASE_DE_DATOS);

export const MOTIVO_SALTO =
  'Sin DATABASE_URL: estas pruebas necesitan PostgreSQL 16 con pgvector. ' +
  'Arranca el Compose con `pnpm dev:up` o deja que las ejecute el job «Base de datos» de la CI.';

/**
 * La carga completa —un millón de entradas y cien mil mensajes— escribe el informe
 * del plan. El resto de ejecuciones usan una carga reducida y solo comprueban que
 * el percentil sigue por debajo del límite.
 */
export const ES_CARGA_COMPLETA = process.env['AIW_PRUEBA_CARGA'] === '1';

/** Límite del plan para las consultas del panel, en milisegundos y en el percentil 95. */
export const LIMITE_PANEL_MS = 200;

/** Tamaño de la carga. Por defecto, la reducida; la completa se pide por entorno. */
export function tamanoDeCarga(): { entradasAuditoria: number; mensajes: number } {
  const porDefecto = ES_CARGA_COMPLETA
    ? { entradas: 1_000_000, mensajes: 100_000 }
    : { entradas: 10_000, mensajes: 1_000 };
  return {
    entradasAuditoria: Number(process.env['AIW_CARGA_ENTRADAS'] ?? porDefecto.entradas),
    mensajes: Number(process.env['AIW_CARGA_MENSAJES'] ?? porDefecto.mensajes),
  };
}

export function conectar(maxConexiones = 5): postgres.Sql {
  if (!URL_BASE_DE_DATOS) throw new Error(MOTIVO_SALTO);
  return postgres(URL_BASE_DE_DATOS, { max: maxConexiones, onnotice: () => undefined });
}
