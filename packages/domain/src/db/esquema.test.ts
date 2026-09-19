/**
 * El esquema declarado y la migración aplicada tienen que contar lo mismo.
 * Esta prueba no necesita base de datos: lee el SQL y el registro de tablas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { MIGRACIONES, sentenciasDe } from './migrador.js';
import {
  NOMBRES_TABLAS,
  NOMBRES_TABLAS_CON_TENANT,
  NOMBRES_TABLAS_INMUTABLES,
  NOMBRES_TABLAS_LIBRO,
  NOMBRES_TABLAS_PARTICIONADAS,
  ORDEN_PURGA,
  TABLAS_CON_TENANT,
} from './tablas.js';

const migracion = MIGRACIONES[0];
if (!migracion) throw new Error('No hay migración inicial.');
const sql = readFileSync(migracion.ruta, 'utf8');
const reverso = readFileSync(migracion.rutaReverso, 'utf8');

function creaTabla(nombre: string): boolean {
  return new RegExp(`create table (if not exists )?${nombre}\\b`).test(sql);
}

describe('registro de tablas', () => {
  it('toda tabla de tenant declara la columna tenant_id', () => {
    for (const tabla of TABLAS_CON_TENANT) {
      const columnas = getTableColumns(tabla);
      const tenant = columnas['tenantId'];
      expect(tenant, `${getTableName(tabla)} no declara tenantId`).toBeDefined();
      expect(tenant?.name).toBe('tenant_id');
      expect(tenant?.notNull, `${getTableName(tabla)}.tenant_id admite nulos`).toBe(true);
    }
  });

  it('el orden de purga cubre todas las tablas de tenant y la organización', () => {
    const enPurga = new Set(ORDEN_PURGA);
    for (const nombre of NOMBRES_TABLAS_CON_TENANT) {
      // El libro nunca se purga: se exporta y la retención suelta particiones.
      if (nombre === 'entrada_auditoria') continue;
      expect(enPurga.has(nombre), `${nombre} falta en el orden de purga`).toBe(true);
    }
    expect(enPurga.has('organizacion')).toBe(true);
    expect(enPurga.has('entrada_auditoria')).toBe(false);
  });

  it('el libro de auditoría y el contador están declarados', () => {
    expect([...NOMBRES_TABLAS_LIBRO]).toEqual(['entrada_auditoria', 'contador_consumo']);
  });
});

describe('migración inicial', () => {
  it('crea todas las tablas del registro', () => {
    for (const nombre of NOMBRES_TABLAS) {
      expect(creaTabla(nombre), `la migración no crea ${nombre}`).toBe(true);
    }
  });

  it('cada tabla de tenant tiene al menos un índice que empieza por tenant_id', () => {
    for (const nombre of NOMBRES_TABLAS_CON_TENANT) {
      const patron = new RegExp(`create (unique )?index \\w+ on ${nombre} \\(tenant_id`);
      expect(patron.test(sql), `${nombre} no tiene índice que empiece por tenant_id`).toBe(true);
    }
  });

  it('activa y fuerza la seguridad a nivel de fila en toda tabla de tenant', () => {
    for (const nombre of NOMBRES_TABLAS_CON_TENANT) {
      // Las tablas de tenant se activan en bloque desde el array del DO; las raíces, aparte.
      expect(
        sql.includes(`'${nombre}'`) || sql.includes(`alter table ${nombre} enable row level`),
      ).toBe(true);
    }
    expect(sql).toContain('alter table organizacion enable row level security');
    expect(sql).toContain('alter table organizacion force row level security');
    expect(sql).toContain('create policy organizacion_tenant on organizacion');
  });

  it('particiona por mes las tres tablas que crecen con el tiempo', () => {
    for (const nombre of NOMBRES_TABLAS_PARTICIONADAS) {
      expect(sql).toContain(`partition by range (creado_en)`);
      expect(sql).toContain(`create table ${nombre}_defecto partition of ${nombre} default`);
      expect(sql).toContain(`crear_particion_mensual('${nombre}', current_date)`);
    }
  });

  it('deja el libro de auditoría sin actualizar ni borrar para el rol de aplicación', () => {
    expect(sql).toContain('revoke update, delete on entrada_auditoria from aiw_app');
    expect(sql).toContain('create trigger entrada_auditoria_sin_actualizar');
  });

  it('la entrada de auditoría no referencia entidades por clave foránea', () => {
    const bloque = sql.slice(
      sql.indexOf('create table entrada_auditoria'),
      sql.indexOf('create index entrada_auditoria_tenant_orden_idx'),
    );
    expect(bloque.length).toBeGreaterThan(0);
    expect(bloque).not.toContain('references');
  });

  it('las claves foráneas restringen el borrado', () => {
    const referencias = sql.match(/references \w+ \(\w+\)( on delete \w+)?/g) ?? [];
    expect(referencias.length).toBeGreaterThan(30);
    for (const referencia of referencias) {
      expect(referencia, `${referencia} no restringe el borrado`).toContain('on delete restrict');
    }
  });

  it('crea la extensión pgvector y los índices HNSW de la memoria', () => {
    expect(sql).toContain('create extension if not exists vector');
    expect(sql).toContain('create index memoria_embedding_hnsw on memoria using hnsw');
    expect(sql).toContain(
      'create index fragmento_conocimiento_embedding_hnsw on fragmento_conocimiento using hnsw',
    );
  });

  it('no lleva ninguna credencial', () => {
    expect(sql).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s@]+@/);
    expect(sql.toLowerCase()).not.toContain('password ');
  });
});

describe('reverso de la migración', () => {
  it('borra todas las tablas que crea la migración', () => {
    for (const nombre of NOMBRES_TABLAS) {
      expect(reverso, `el reverso no borra ${nombre}`).toContain(`drop table if exists ${nombre};`);
    }
  });

  it('borra los roles y las funciones', () => {
    expect(reverso).toContain('uuid_generar_v7');
    expect(reverso).toContain('aiw_tenant_actual');
    expect(reverso).toContain('drop role aiw_app');
  });
});

describe('troceado de sentencias', () => {
  it('separa la migración en sentencias y no deja comentarios sueltos', () => {
    const sentencias = sentenciasDe(sql);
    expect(sentencias.length).toBeGreaterThan(100);
    for (const sentencia of sentencias) {
      expect(sentencia.trim().length).toBeGreaterThan(0);
    }
  });

  it('mantiene enteros los cuerpos de función con $$', () => {
    const conCuerpo = sentenciasDe(sql).filter((s) => s.includes('$$'));
    expect(conCuerpo.length).toBeGreaterThan(0);
    for (const sentencia of conCuerpo) {
      const marcas = sentencia.split('$$').length - 1;
      expect(marcas % 2, 'un cuerpo de función quedó partido').toBe(0);
    }
  });
});

describe('tablas inmutables', () => {
  it('no declaran columna de actualización', () => {
    for (const tabla of TABLAS_CON_TENANT) {
      const nombre = getTableName(tabla);
      if (!NOMBRES_TABLAS_INMUTABLES.includes(nombre as never)) continue;
      const columnas = Object.values(getTableColumns(tabla)).map((c) => c.name);
      expect(columnas, `${nombre} es inmutable y no debe tener actualizado_en`).not.toContain(
        'actualizado_en',
      );
    }
  });
});

describe('el fichero de migración está en el paquete', () => {
  it('la ruta apunta dentro de packages/domain/drizzle', () => {
    expect(fileURLToPath(new URL('../../drizzle/', import.meta.url))).toContain(
      'packages/domain/drizzle',
    );
  });
});
