/**
 * La migración de identidad dice lo que el esquema declara, sin base de datos.
 */
import { readFileSync } from 'node:fs';

import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { sesion, usuario } from './identidad.js';
import { MIGRACIONES } from './migrador.js';
import {
  NOMBRES_TABLAS_CON_TENANT,
  NOMBRES_TABLAS_IDENTIDAD,
  ORDEN_PURGA_IDENTIDAD,
} from './tablas.js';

const migracion = MIGRACIONES.find((m) => m.nombre === '0005_acceso_al_panel');
if (!migracion) throw new Error('No hay migración del acceso al panel.');
const sql = readFileSync(migracion.ruta, 'utf8');
const reverso = readFileSync(migracion.rutaReverso, 'utf8');

describe('migración del acceso al panel', () => {
  it('crea las cinco tablas de identidad y su reverso las borra', () => {
    expect([...NOMBRES_TABLAS_IDENTIDAD]).toEqual([
      'usuario',
      'sesion',
      'cuenta',
      'verificacion',
      'clave_acceso',
    ]);
    for (const nombre of NOMBRES_TABLAS_IDENTIDAD) {
      expect(sql).toMatch(new RegExp(`create table ${nombre} \\(`));
      expect(reverso).toContain(`drop table if exists ${nombre};`);
    }
  });

  it('las tablas de identidad no se exportan con los datos del cliente', () => {
    for (const nombre of NOMBRES_TABLAS_IDENTIDAD) {
      expect(NOMBRES_TABLAS_CON_TENANT).not.toContain(nombre);
    }
  });

  it('activa, fuerza y da política a las cinco, con la del rol de identidad', () => {
    expect(sql).toContain(
      "v_tablas text[] := array['usuario', 'sesion', 'cuenta', 'verificacion', 'clave_acceso']",
    );
    expect(sql).toContain("'alter table %I enable row level security'");
    expect(sql).toContain("'alter table %I force row level security'");
    expect(sql).toContain('to aiw_identidad using (true) with check (true)');
    for (const nombre of ['usuario', 'sesion', 'cuenta', 'clave_acceso']) {
      expect(sql).toContain(`create policy ${nombre}_tenant on ${nombre}`);
    }
  });

  it('el rol de aplicación no recibe ningún permiso y el de identidad solo los suyos', () => {
    expect(sql).toContain(
      'revoke all on usuario, sesion, cuenta, verificacion, clave_acceso from aiw_app;',
    );
    expect(sql).not.toMatch(/grant [^;]* to aiw_app/);
    const permisos = sql.match(/grant [^;]* to aiw_identidad;/g) ?? [];
    for (const permiso of permisos) {
      expect(permiso).not.toMatch(/persona|organizacion|entrada_auditoria|all tables/);
    }
  });

  it('el tenant de la sesión lo pone un disparador desde el usuario', () => {
    expect(sql).toContain('create trigger sesion_de_usuario');
    expect(sql).toContain('select u.tenant_id, u.persona_id into new.tenant_id, new.persona_id');
    expect(sql).toContain('create trigger usuario_sin_mudanza');
  });

  it('ninguna cuenta guarda contraseña ni tokens de OAuth', () => {
    expect(sql).toMatch(/constraint cuenta_sin_credenciales check \(\s+contrasena is null/);
  });

  it('ninguna clave foránea borra en cascada', () => {
    expect(sql).not.toMatch(/on delete cascade/i);
  });

  it('el reverso suelta el rol de identidad', () => {
    expect(reverso).toContain("execute 'drop role aiw_identidad'");
  });

  it('sesión y usuario declaran tenant y persona obligatorios', () => {
    for (const tabla of [usuario, sesion]) {
      const columnas = getTableColumns(tabla);
      expect(columnas.tenantId.notNull).toBe(true);
      expect(columnas.personaId.notNull).toBe(true);
    }
  });

  it('la purga vacía la identidad de la hoja a la raíz', () => {
    expect(ORDEN_PURGA_IDENTIDAD.map((p) => p.tabla)).toEqual([
      'clave_acceso',
      'cuenta',
      'sesion',
      'usuario',
    ]);
  });
});
