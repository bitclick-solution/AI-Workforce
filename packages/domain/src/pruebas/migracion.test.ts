/**
 * La migración se aplica, se deshace y no deja deriva.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` estas pruebas se saltan con un mensaje.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { aplicarMigraciones, comprobarHuellas } from '../db/migrador.js';
import {
  NOMBRES_TABLAS,
  NOMBRES_TABLAS_CON_TENANT,
  NOMBRES_TABLAS_PARTICIONADAS,
} from '../db/tablas.js';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from './entorno.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'migración inicial'
  : `migración inicial — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;

  beforeAll(async () => {
    cliente = conectar(2);
    await aplicarMigraciones(cliente);
  });

  afterAll(async () => {
    await cliente?.end({ timeout: 5 });
  });

  it('aplicarla otra vez no cambia nada', async () => {
    const resultado = await aplicarMigraciones(cliente);
    expect(resultado.aplicadas).toEqual([]);
    expect(resultado.yaAplicadas).toContain('0000_inicial');
  });

  it('ninguna migración aplicada cambió de contenido', async () => {
    expect(await comprobarHuellas(cliente)).toEqual([]);
  });

  it('crea todas las tablas del registro', async () => {
    const filas = await cliente<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
    `;
    const existentes = new Set(filas.map((f) => f.relname));
    for (const nombre of NOMBRES_TABLAS) {
      expect(existentes.has(nombre), `falta la tabla ${nombre}`).toBe(true);
    }
  });

  it('toda tabla lleva la seguridad a nivel de fila activada y forzada', async () => {
    const filas = await cliente<{ relname: string }[]>`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1
    `;
    // `migracion_aplicada` es infraestructura: no tiene tenant y el rol de
    // aplicación no tiene ningún permiso sobre ella.
    expect(filas.map((f) => f.relname)).toEqual(['migracion_aplicada']);
  });

  it('toda tabla con tenant tiene su política de tenant', async () => {
    const filas = await cliente<{ tablename: string }[]>`
      select tablename from pg_policies where schemaname = 'public'
    `;
    const conPolitica = new Set(filas.map((f) => f.tablename));
    for (const nombre of NOMBRES_TABLAS_CON_TENANT) {
      expect(conPolitica.has(nombre), `${nombre} no tiene política de RLS`).toBe(true);
    }
    expect(conPolitica.has('organizacion')).toBe(true);
    expect(conPolitica.has('organizacion_paraguas')).toBe(true);
  });

  it('las tres tablas que crecen con el tiempo están particionadas por mes', async () => {
    for (const tabla of NOMBRES_TABLAS_PARTICIONADAS) {
      const [fila] = await cliente<{ estrategia: string }[]>`
        select p.partstrat as estrategia
        from pg_partitioned_table p
        join pg_class c on c.oid = p.partrelid
        where c.relname = ${tabla}
      `;
      expect(fila?.estrategia, `${tabla} no está particionada`).toBe('r');
    }
  });

  it('existen las particiones del mes actual y del siguiente', async () => {
    const ahora = new Date();
    const siguiente = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1));
    const sufijos = [
      `${ahora.getUTCFullYear()}_${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`,
      `${siguiente.getUTCFullYear()}_${String(siguiente.getUTCMonth() + 1).padStart(2, '0')}`,
    ];
    const filas = await cliente<{ relname: string }[]>`
      select c.relname from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
      where p.relname in ('entrada_auditoria', 'mensaje', 'senal') and c.relkind = 'r'
    `;
    const particiones = new Set(filas.map((f) => f.relname));
    for (const tabla of NOMBRES_TABLAS_PARTICIONADAS) {
      expect(particiones.has(`${tabla}_defecto`), `falta ${tabla}_defecto`).toBe(true);
      for (const sufijo of sufijos) {
        expect(particiones.has(`${tabla}_${sufijo}`), `falta ${tabla}_${sufijo}`).toBe(true);
      }
    }
  });

  it('crear_particion_mensual crea la de un mes futuro y es idempotente', async () => {
    const futuro = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 6, 1));
    const fecha = futuro.toISOString().slice(0, 10);
    const [primera] = await cliente<{ crear_particion_mensual: string }[]>`
      select crear_particion_mensual('mensaje', ${fecha}::date)
    `;
    const [segunda] = await cliente<{ crear_particion_mensual: string }[]>`
      select crear_particion_mensual('mensaje', ${fecha}::date)
    `;
    expect(primera?.crear_particion_mensual).toBe(segunda?.crear_particion_mensual);

    const [fila] = await cliente<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select relrowsecurity, relforcerowsecurity from pg_class
      where relname = ${primera?.crear_particion_mensual ?? ''}
    `;
    expect(fila?.relrowsecurity).toBe(true);
    expect(fila?.relforcerowsecurity).toBe(true);

    await cliente.unsafe(`drop table ${primera?.crear_particion_mensual ?? ''}`);
  });

  it('rechaza crear particiones de una tabla que no se particiona por mes', async () => {
    await expect(cliente`select crear_particion_mensual('persona', current_date)`).rejects.toThrow(
      /no particionada/,
    );
  });

  it('el rol de aplicación existe y no puede saltarse la seguridad de fila', async () => {
    const [fila] = await cliente<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      select rolbypassrls, rolsuper from pg_roles where rolname = 'aiw_app'
    `;
    expect(fila?.rolbypassrls).toBe(false);
    expect(fila?.rolsuper).toBe(false);
  });
});
