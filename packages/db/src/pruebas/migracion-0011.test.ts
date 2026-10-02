/**
 * La migración `0011` en una base vacía: se aplica, se deshace sola y se vuelve a
 * aplicar. `db:revertir` deshace todas las migraciones, no solo la última, así que el
 * reverso de la `0011` se prueba aparte, sobre una base de usar y tirar que se crea y
 * se borra dentro de la prueba y no toca la del resto de pruebas.
 *
 * Necesita PostgreSQL con permiso para crear bases: sin `DATABASE_URL` se salta.
 */
import { readFileSync } from 'node:fs';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aplicarMigraciones, MIGRACIONES, sentenciasDe } from '../migrador.js';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, URL_BASE_DE_DATOS } from './entorno.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'migración 0011 en base vacía'
  : `migración 0011 en base vacía — SALTADO. ${MOTIVO_SALTO}`;

const NOMBRE = '0011_promocion_version';

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  const nombreBase = `aiw_0011_${Date.now().toString(36)}`;
  let administrador: postgres.Sql;
  let cliente: postgres.Sql;

  beforeAll(async () => {
    administrador = postgres(URL_BASE_DE_DATOS ?? '', { max: 1, onnotice: () => undefined });
    await administrador.unsafe(`create database ${nombreBase}`);
    const url = new URL(URL_BASE_DE_DATOS ?? '');
    url.pathname = `/${nombreBase}`;
    cliente = postgres(url.toString(), { max: 1, onnotice: () => undefined });
  });

  afterAll(async () => {
    await cliente?.end({ timeout: 5 });
    await administrador?.unsafe(`drop database if exists ${nombreBase}`);
    await administrador?.end({ timeout: 5 });
  });

  async function existeLaTabla(): Promise<boolean> {
    const [fila] = await cliente<{ existe: boolean }[]>`
      select to_regclass('public.promocion_version') is not null as existe
    `;
    return fila?.existe === true;
  }

  it('se aplica sobre una base vacía junto con las anteriores', async () => {
    const resultado = await aplicarMigraciones(cliente);
    expect(resultado.aplicadas).toContain(NOMBRE);
    expect(await existeLaTabla()).toBe(true);
  });

  it('su reverso suelto quita la tabla y deja el resto como estaba', async () => {
    const migracion = MIGRACIONES.find((m) => m.nombre === NOMBRE);
    if (!migracion) throw new Error(`No hay migración ${NOMBRE}.`);
    await cliente.begin(async (tx) => {
      for (const sentencia of sentenciasDe(readFileSync(migracion.rutaReverso, 'utf8'))) {
        await tx.unsafe(sentencia);
      }
      await tx`delete from migracion_aplicada where nombre = ${NOMBRE}`;
    });
    expect(await existeLaTabla()).toBe(false);
    const [fila] = await cliente<{ n: string }[]>`
      select count(*)::text as n from migracion_aplicada
    `;
    expect(Number(fila?.n)).toBe(MIGRACIONES.length - 1);
    // La promoción y su índice único de la 0002 siguen donde estaban.
    const [indice] = await cliente<{ n: string }[]>`
      select count(*)::text as n from pg_indexes where indexname = 'promocion_tenant_leccion_key'
    `;
    expect(Number(indice?.n)).toBe(1);
  });

  it('se vuelve a aplicar sin error y la tabla queda con su RLS y su disparador', async () => {
    const resultado = await aplicarMigraciones(cliente);
    expect(resultado.aplicadas).toEqual([NOMBRE]);
    expect(await existeLaTabla()).toBe(true);
    const [fila] = await cliente<{ rls: boolean; forzada: boolean; disparadores: string }[]>`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forzada,
        (select count(*)::text from pg_trigger t
          where t.tgrelid = c.oid and t.tgname = 'promocion_version_sin_actualizar') as disparadores
      from pg_class c where c.relname = 'promocion_version'
    `;
    expect(fila).toEqual({ rls: true, forzada: true, disparadores: '1' });
  });
});
