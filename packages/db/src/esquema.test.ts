/**
 * El esquema declarado y la migración aplicada tienen que contar lo mismo.
 * Esta prueba no necesita base de datos: lee el SQL y el registro de tablas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PLANES, esquemas } from '@aiw/domain';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { CONSULTAS_PANEL } from './carga.js';
import { MIGRACIONES, sentenciasDe } from './migrador.js';
import {
  NOMBRES_TABLAS,
  NOMBRES_TABLAS_CONTADOR,
  NOMBRES_TABLAS_CONTADOR_INMUTABLES,
  NOMBRES_TABLAS_CON_TENANT,
  NOMBRES_TABLAS_INMUTABLES,
  NOMBRES_TABLAS_INMUTABLES_CON_DISPARADOR_PROPIO,
  NOMBRES_TABLAS_INMUTABLES_EN_BUCLE,
  NOMBRES_TABLAS_PROMOCION,
  NOMBRES_TABLAS_LIBRO,
  NOMBRES_TABLAS_PARTICIONADAS,
  ORDEN_PURGA,
  TABLAS_CON_TENANT,
} from './tablas.js';

const { planOrganizacion } = esquemas;

const migracion = MIGRACIONES[0];
if (!migracion) throw new Error('No hay migración inicial.');
const sql = readFileSync(migracion.ruta, 'utf8');
const reverso = readFileSync(migracion.rutaReverso, 'utf8');

/**
 * El modelo ya no cabe en una sola migración: lo que se comprueba sobre el conjunto
 * —que existen todas las tablas del registro, que el reverso las borra y que ninguna
 * clave foránea deja borrar en cascada— se lee de todas, y lo que es propio de la
 * inicial se sigue leyendo de ella.
 */
const sqlDeTodas = MIGRACIONES.map((m) => readFileSync(m.ruta, 'utf8')).join('\n');
const reversoDeTodas = MIGRACIONES.map((m) => readFileSync(m.rutaReverso, 'utf8')).join('\n');

/** El contador v0 trae su propia migración; las pruebas que la miran usan esta. */
const contador = MIGRACIONES.find((m) => m.nombre === '0001_contador_uso_de_modelos');
if (!contador) throw new Error('No hay migración del contador de tareas v0.');
const sqlContador = readFileSync(contador.ruta, 'utf8');
const reversoContador = readFileSync(contador.rutaReverso, 'utf8');

function creaTabla(nombre: string): boolean {
  return new RegExp(`create table (if not exists )?${nombre}\\b`).test(sqlDeTodas);
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
    const referencias = sqlDeTodas.match(/references \w+ \(\w+\)( on delete \w+)?/g) ?? [];
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
  it('borra todas las tablas que crean las migraciones', () => {
    for (const nombre of NOMBRES_TABLAS) {
      expect(reversoDeTodas, `ningún reverso borra ${nombre}`).toContain(
        `drop table if exists ${nombre};`,
      );
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

  it('la lista del código y la del bucle de la migración son la misma', () => {
    const bloque = sql.slice(
      sql.indexOf("v_tablas text[] := array[\n    'version_puesto'"),
      sql.indexOf(
        "foreach v_tabla in array v_tablas loop\n    execute format(\n      'create trigger",
      ),
    );
    expect(bloque.length, 'no encuentro el bucle de tablas inmutables').toBeGreaterThan(0);
    const enLaMigracion = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enLaMigracion.sort()).toEqual([...NOMBRES_TABLAS_INMUTABLES_EN_BUCLE].sort());
  });

  it('la migración le retira UPDATE y DELETE al rol de aplicación en todas', () => {
    for (const nombre of NOMBRES_TABLAS_INMUTABLES_CON_DISPARADOR_PROPIO) {
      expect(sql, `${nombre} no pierde update y delete`).toContain(
        `revoke update, delete on ${nombre} from aiw_app`,
      );
    }
    // Las del bucle lo hacen con format(); el bucle es lo que se comprueba arriba.
    expect(sql).toContain("execute format('revoke update, delete on %I from aiw_app', v_tabla)");
  });

  it('ningún UPDATE se permite, ni al dueño del esquema', () => {
    expect(sql).toContain('create or replace function aiw_fila_inmutable()');
    expect(sql).toContain(
      "'create trigger %I before update on %I for each row execute function aiw_fila_inmutable()'",
    );
    expect(reverso).toContain('drop function if exists aiw_fila_inmutable();');
  });
});

describe('el fichero de migración está en el paquete', () => {
  it('la ruta apunta dentro de packages/db/drizzle', () => {
    expect(fileURLToPath(new URL('../drizzle/', import.meta.url))).toContain('packages/db/drizzle');
  });
});

describe('el migrador asume el rol dueño del esquema', () => {
  it('se pone aiw_migrador antes de crear nada y le da permiso sobre el esquema', () => {
    const rol = sql.indexOf('set local role aiw_migrador');
    const primeraFuncion = sql.indexOf('create or replace function uuid_generar_v7');
    const primerTipo = sql.indexOf('create type ');
    const primeraTabla = sql.indexOf('create table ');
    expect(rol, 'la migración nunca asume aiw_migrador').toBeGreaterThan(-1);
    expect(sql).toContain('grant usage, create on schema public to aiw_migrador');
    expect(rol).toBeLessThan(primeraFuncion);
    expect(rol).toBeLessThan(primerTipo);
    expect(rol).toBeLessThan(primeraTabla);
  });

  it('el reverso lo suelta antes de borrar el rol', () => {
    expect(reverso.indexOf('reset role;')).toBeLessThan(reverso.indexOf('drop role aiw_migrador'));
  });
});

describe('la decisión de una aprobación es una fila propia', () => {
  it('la aprobación no guarda ni decisión ni fecha de decisión', () => {
    const bloque = sql.slice(
      sql.indexOf('create table aprobacion ('),
      sql.indexOf('create index aprobacion_tenant_tarea_idx'),
    );
    expect(bloque.length).toBeGreaterThan(0);
    expect(bloque).not.toContain('decision');
    expect(bloque).not.toContain('decidida_en');
  });

  it('una aprobación no puede tener dos decisiones', () => {
    expect(sql).toContain(
      'create unique index decision_aprobacion_tenant_aprobacion_key on decision_aprobacion (tenant_id, aprobacion_id)',
    );
  });

  it('el sentido de la decisión no admite «pendiente»', () => {
    expect(sql).toContain(
      "create type sentido_decision as enum ('aprobada', 'rechazada', 'editada')",
    );
    expect(sql).not.toContain('create type decision_aprobacion as enum');
  });

  it('el panel pregunta por aprobaciones sin decisión, no por un estado', () => {
    const consulta = CONSULTAS_PANEL.find((c) => c.nombre.includes('aprobaciones'));
    expect(consulta?.sql).toContain('not exists');
    expect(consulta?.sql).toContain('decision_aprobacion');
    expect(consulta?.sql).not.toContain("decision = 'pendiente'");
  });
});

describe('el plan y la retención siguen los ADR', () => {
  it('el plan es texto validado por Zod y no un tipo enum', () => {
    expect(sql).toContain('plan text not null');
    expect(sql).not.toContain('create type plan_organizacion');
    for (const plan of PLANES) {
      expect(planOrganizacion.parse(plan)).toBe(plan);
    }
    expect(() => planOrganizacion.parse('starter')).toThrow();
  });

  it('la retención va de 6 a 120 meses y por defecto son 24 (ADR-010)', () => {
    expect(sql).toContain('retencion_meses bigint not null default 24');
    expect(sql).toContain('check (retencion_meses between 6 and 120)');
  });
});

describe('migración del contador de tareas v0', () => {
  it('crea las dos tablas del contador con su tenant y su índice por tenant', () => {
    for (const nombre of NOMBRES_TABLAS_CONTADOR) {
      expect(sqlContador, `la migración no crea ${nombre}`).toContain(`create table ${nombre} (`);
      expect(sqlContador).toContain(
        `tenant_id uuid not null references organizacion (id) on delete restrict`,
      );
      const patron = new RegExp(`create (unique )?index \\w+\\s+on ${nombre} \\(tenant_id`);
      expect(patron.test(sqlContador), `${nombre} no tiene índice que empiece por tenant_id`).toBe(
        true,
      );
    }
  });

  it('activa y fuerza la seguridad de fila y crea la política de tenant', () => {
    for (const nombre of NOMBRES_TABLAS_CONTADOR) {
      expect(sqlContador, `${nombre} no entra en el bucle de RLS`).toContain(`'${nombre}'`);
    }
    expect(sqlContador).toContain("execute format('alter table %I enable row level security'");
    expect(sqlContador).toContain("execute format('alter table %I force row level security'");
    expect(sqlContador).toContain('using (tenant_id = aiw_tenant_actual())');
  });

  it('el rol de aplicación solo lee e inserta: las filas son inmutables', () => {
    for (const nombre of NOMBRES_TABLAS_CONTADOR_INMUTABLES) {
      expect(sqlContador).toContain(`grant select, insert on ${nombre} to aiw_app`);
      expect(sqlContador, `${nombre} no tiene disparador de inmutabilidad`).toContain(
        `create trigger ${nombre}_sin_actualizar`,
      );
      expect(sqlContador).not.toContain(`grant select, insert, update, delete on ${nombre}`);
    }
    expect(sqlContador).toContain('execute function aiw_fila_inmutable()');
  });

  it('el reintento de una actividad no cobra dos veces: la única la impone la base', () => {
    expect(sqlContador).toContain(
      'create unique index uso_modelo_tenant_clave_key on uso_modelo (tenant_id, clave_idempotencia)',
    );
    expect(sqlContador).toContain('constraint uso_modelo_tokens_no_negativos');
    expect(sqlContador).toContain('constraint uso_modelo_llamadas_positivas');
  });

  it('la tarifa es un dato con vigencia y sin cierre de vigencia que actualizar', () => {
    expect(sqlContador).toContain('vigente_desde timestamptz not null');
    expect(sqlContador).not.toContain('vigente_hasta');
    expect(sqlContador).toContain(
      'create unique index tarifa_modelo_tenant_modelo_vigencia_key\n  on tarifa_modelo (tenant_id, proveedor, modelo, vigente_desde)',
    );
    expect(sqlContador).toContain('constraint tarifa_modelo_precios_no_negativos');
  });

  it('es autocontenida y no depende del orden: no altera nada de lo que ya existe', () => {
    expect(sqlContador).not.toMatch(/alter table (?!%I)\w+ (add|drop|alter) /);
    expect(sqlContador).not.toContain('create extension');
    expect(sqlContador).not.toContain('create role');
    expect(sqlContador).not.toContain('create or replace function');
    // Asume el dueño del esquema antes de crear nada, igual que la inicial.
    const rol = sqlContador.indexOf('set local role aiw_migrador');
    expect(rol).toBeGreaterThan(-1);
    expect(rol).toBeLessThan(sqlContador.indexOf('create table '));
  });

  it('su reverso borra sus tablas de la hoja a la raíz y no toca la inicial', () => {
    expect(reversoContador.indexOf('drop table if exists uso_modelo;')).toBeLessThan(
      reversoContador.indexOf('drop table if exists tarifa_modelo;'),
    );
    expect(reversoContador).not.toContain('drop role');
    expect(reversoContador).not.toContain('drop function');
    expect(reversoContador).not.toContain('drop table if exists tarea;');
  });

  it('no lleva ninguna credencial ni ningún precio escrito a mano', () => {
    expect(sqlContador).not.toMatch(/postgres(ql)?:\/\/[^\s]*:[^\s@]+@/);
    expect(sqlContador.toLowerCase()).not.toContain('password ');
    // Los precios son dato del tenant: en el DDL solo cabe el cero por defecto.
    const defectosNumericos = sqlContador.match(/euros_por_millon\w* numeric\(\d+, \d+\)[^,]*/g);
    for (const linea of defectosNumericos ?? []) {
      expect(linea).not.toMatch(/default (?!0\b)\d/);
    }
  });
});

describe('migración del uso de modelo de plataforma (0010)', () => {
  const migracion = MIGRACIONES.find((m) => m.nombre === '0010_uso_modelo_de_plataforma');
  if (!migracion) throw new Error('No hay migración del uso de modelo de plataforma.');
  const sql = readFileSync(migracion.ruta, 'utf8');
  const reverso = readFileSync(migracion.rutaReverso, 'utf8');

  it('solo altera uso_modelo, asumiendo el dueño del esquema antes de tocarlo', () => {
    expect(sql).not.toContain('create table');
    expect(sql).not.toContain('create extension');
    expect(sql).not.toContain('drop table');
    expect(sql.match(/alter table (\w+)/g)).toEqual([
      'alter table uso_modelo',
      'alter table uso_modelo',
    ]);
    expect(sql.indexOf('set local role aiw_migrador')).toBeLessThan(
      sql.indexOf('alter table uso_modelo'),
    );
  });

  it('una fila es de un puesto o de la plataforma, nunca de las dos ni de ninguna', () => {
    expect(sql).toContain('constraint uso_modelo_origen_coherente check');
    expect(sql).toContain("actor_plataforma in ('moderador', 'director_ia')");
    for (const columna of ['tarea_id', 'tarea_raiz_id', 'puesto_id', 'version_puesto_id']) {
      expect(sql).toContain(`alter column ${columna} drop not null`);
    }
    expect(sql).toContain('sala_id uuid references sala (id) on delete restrict');
  });

  it('su reverso borra el uso de plataforma antes de volver a exigir tarea y puesto', () => {
    expect(reverso.indexOf('delete from uso_modelo where sala_id is not null')).toBeLessThan(
      reverso.indexOf('alter column tarea_id set not null'),
    );
    expect(reverso.indexOf('drop constraint if exists uso_modelo_origen_coherente')).toBeLessThan(
      reverso.indexOf('drop column if exists sala_id'),
    );
    expect(reverso).not.toContain('drop table');
  });

  it('el uso de modelo se purga antes que la sala, que ahora referencia', () => {
    expect(ORDEN_PURGA.indexOf('uso_modelo')).toBeLessThan(ORDEN_PURGA.indexOf('sala'));
    expect(ORDEN_PURGA.indexOf('uso_modelo')).toBeLessThan(ORDEN_PURGA.indexOf('tarifa_modelo'));
  });
});

describe('migración de la promoción de varias versiones (0011)', () => {
  const migracion = MIGRACIONES.find((m) => m.nombre === '0011_promocion_version');
  if (!migracion) throw new Error('No hay migración de la promoción de varias versiones.');
  const sql = readFileSync(migracion.ruta, 'utf8');
  const reverso = readFileSync(migracion.rutaReverso, 'utf8');

  it('solo crea promocion_version, asumiendo el dueño del esquema antes', () => {
    expect(sql.match(/create table (\w+)/g)).toEqual(['create table promocion_version']);
    expect(sql).not.toContain('alter table promocion ');
    expect(sql).not.toContain('drop ');
    expect(sql.indexOf('set local role aiw_migrador')).toBeLessThan(
      sql.indexOf('create table promocion_version'),
    );
  });

  it('lleva tenant, RLS forzada y un índice único por promoción y puesto', () => {
    expect(sql).toContain(
      'tenant_id uuid not null references organizacion (id) on delete restrict',
    );
    expect(sql).toContain('alter table promocion_version enable row level security');
    expect(sql).toContain('alter table promocion_version force row level security');
    expect(sql).toContain('using (tenant_id = aiw_tenant_actual())');
    expect(sql).toContain('on promocion_version (tenant_id, promocion_id, puesto_id)');
    expect(sql).toContain('on promocion_version (tenant_id, version_puesto_id)');
  });

  it('es inmutable: el rol de aplicación solo lee e inserta y un disparador rechaza UPDATE', () => {
    for (const nombre of NOMBRES_TABLAS_PROMOCION) {
      expect(sql).toContain(`grant select, insert on ${nombre} to aiw_app`);
      expect(sql).toContain(`create trigger ${nombre}_sin_actualizar`);
    }
    expect(sql).not.toContain('grant select, insert, update, delete on promocion_version');
  });

  it('su reverso solo borra la tabla nueva y no toca promocion', () => {
    expect(reverso).toContain('drop table if exists promocion_version');
    expect(reverso.match(/drop table/g)).toHaveLength(1);
    expect(reverso).not.toContain('promocion;');
  });

  it('se purga antes que la promoción que referencia', () => {
    expect(ORDEN_PURGA.indexOf('promocion_version')).toBeLessThan(ORDEN_PURGA.indexOf('promocion'));
  });
});
