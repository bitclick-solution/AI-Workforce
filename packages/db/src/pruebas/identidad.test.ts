/**
 * Identidad del panel en la base: quién ve las tablas de Better Auth y qué tenant
 * lleva una sesión.
 *
 * Tres roles, tres miradas:
 *   - `aiw_identidad` ve todas las filas de las cinco tablas, porque el acceso
 *     ocurre antes de saber el tenant, y nada más del modelo.
 *   - `aiw_app` no tiene ningún permiso sobre ellas: una consulta de negocio no
 *     puede leer un token de sesión, ni de su propio tenant.
 *   - Con el tenant fijado y el rol de aplicación, el resto del modelo sigue
 *     aislado: sin tenant, cero filas; con el de otra organización, cero filas.
 */
import { randomBytes } from 'node:crypto';

import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ROL_APLICACION, conTenantYRol } from '../cliente.js';
import { ROL_IDENTIDAD } from '../identidad.js';
import { uuidV7 } from '../identificadores.js';
import { purgarOrganizacion } from '../mantenimiento.js';
import { aplicarMigraciones } from '../migrador.js';
import { NOMBRES_TABLAS_IDENTIDAD } from '../tablas.js';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from './entorno.js';
import { sembrarOrganizacion, type OrganizacionSembrada } from './semilla.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'identidad del panel en la base'
  : `identidad del panel en la base — SALTADO. ${MOTIVO_SALTO}`;

/** Ejecuta el cuerpo como `aiw_identidad`, sin tenant: así corre Better Auth. */
async function comoIdentidad<T>(
  cliente: postgres.Sql,
  cuerpo: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return cliente.begin(async (tx) => {
    await tx.unsafe(`set local role ${ROL_IDENTIDAD}`);
    return cuerpo(tx);
  }) as Promise<T>;
}

/** Un token opaco generado en la prueba: nunca un literal en el código. */
function tokenAleatorio(): string {
  return randomBytes(24).toString('base64url');
}

async function crearUsuario(
  cliente: postgres.Sql,
  organizacion: OrganizacionSembrada,
  correo: string,
): Promise<string> {
  const id = uuidV7();
  await comoIdentidad(cliente, async (tx) => {
    await tx`
      insert into usuario (id, tenant_id, persona_id, nombre, correo)
      values (${id}, ${organizacion.tenantId}, ${organizacion.personaId}, 'Propietaria', ${correo})
    `;
  });
  return id;
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let alfa: OrganizacionSembrada;
  let beta: OrganizacionSembrada;
  let usuarioAlfa: string;
  let usuarioBeta: string;

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    alfa = await sembrarOrganizacion(cliente, 'identidad-alfa');
    beta = await sembrarOrganizacion(cliente, 'identidad-beta');
    const sufijo = uuidV7().slice(-8);
    usuarioAlfa = await crearUsuario(cliente, alfa, `alfa-${sufijo}@ejemplo.local`);
    usuarioBeta = await crearUsuario(cliente, beta, `beta-${sufijo}@ejemplo.local`);
  });

  afterAll(async () => {
    if (alfa) await purgarOrganizacion(cliente, alfa.tenantId);
    if (beta) await purgarOrganizacion(cliente, beta.tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('la sesión hereda tenant y persona de su usuario aunque se le pasen otros', async () => {
    const token = tokenAleatorio();
    // Se intenta colar el tenant y la persona de beta en una sesión de alfa.
    await comoIdentidad(cliente, async (tx) => {
      await tx`
        insert into sesion (tenant_id, persona_id, usuario_id, token, caduca_en)
        values (${beta.tenantId}, ${beta.personaId}, ${usuarioAlfa}, ${token},
                now() + interval '1 hour')
      `;
    });
    const [fila] = await comoIdentidad(
      cliente,
      (tx) => tx<{ tenant_id: string; persona_id: string }[]>`
        select tenant_id, persona_id from sesion where token = ${token}
      `,
    );
    expect(fila).toEqual({ tenant_id: alfa.tenantId, persona_id: alfa.personaId });
  });

  it('una sesión no cambia de usuario ni de tenant', async () => {
    const token = tokenAleatorio();
    await comoIdentidad(cliente, async (tx) => {
      await tx`
        insert into sesion (tenant_id, persona_id, usuario_id, token, caduca_en)
        values (${alfa.tenantId}, ${alfa.personaId}, ${usuarioAlfa}, ${token},
                now() + interval '1 hour')
      `;
    });
    await expect(
      comoIdentidad(
        cliente,
        (tx) => tx`update sesion set usuario_id = ${usuarioBeta} where token = ${token}`,
      ),
    ).rejects.toThrow(/no cambia de usuario/);
    // Alargar la caducidad sí se puede: es lo único que cambia de una sesión.
    await comoIdentidad(
      cliente,
      (tx) => tx`update sesion set caduca_en = now() + interval '2 hours' where token = ${token}`,
    );
  });

  it('un usuario no se muda de tenant', async () => {
    await expect(
      comoIdentidad(
        cliente,
        (tx) => tx`update usuario set tenant_id = ${beta.tenantId} where id = ${usuarioAlfa}`,
      ),
    ).rejects.toThrow(/no cambia de tenant/);
  });

  it('el correo del usuario se guarda en minúsculas y es único en toda la plataforma', async () => {
    await expect(crearUsuario(cliente, beta, 'Mayusculas@Ejemplo.local')).rejects.toThrow(
      /usuario_correo_en_minusculas/,
    );
    const [existente] = await comoIdentidad(
      cliente,
      (tx) => tx<{ correo: string }[]>`select correo from usuario where id = ${usuarioAlfa}`,
    );
    await expect(crearUsuario(cliente, beta, existente?.correo ?? '')).rejects.toThrow(
      /usuario_correo_key|usuario_persona_key/,
    );
  });

  it('ninguna cuenta guarda contraseña', async () => {
    await expect(
      comoIdentidad(
        cliente,
        (tx) => tx`
          insert into cuenta (usuario_id, cuenta_id, proveedor_id, contrasena)
          values (${usuarioAlfa}, ${usuarioAlfa}, 'credential', ${tokenAleatorio()})
        `,
      ),
    ).rejects.toThrow(/cuenta_sin_credenciales/);
  });

  it('el rol de aplicación no puede leer ninguna tabla de identidad, ni de su tenant', async () => {
    for (const tabla of NOMBRES_TABLAS_IDENTIDAD) {
      await expect(
        conTenantYRol(cliente, alfa.tenantId, ROL_APLICACION, (tx) =>
          tx.unsafe(`select count(*) from ${tabla}`),
        ),
        `aiw_app lee ${tabla}`,
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('el rol de identidad ve las dos organizaciones y nada más del modelo', async () => {
    const [cuenta] = await comoIdentidad(
      cliente,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from usuario where id in (${usuarioAlfa}, ${usuarioBeta})
      `,
    );
    expect(Number(cuenta?.total)).toBe(2);
    await expect(comoIdentidad(cliente, (tx) => tx`select count(*) from persona`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      comoIdentidad(cliente, (tx) => tx`select count(*) from entrada_auditoria`),
    ).rejects.toThrow(/permission denied/);
  });

  it('sin tenant fijado, el rol de aplicación no ve ninguna fila', async () => {
    const filas = await cliente.begin(async (tx) => {
      await tx.unsafe(`set local role ${ROL_APLICACION}`);
      return tx<{ total: string }[]>`select count(*) as total from persona`;
    });
    expect(Number(filas[0]?.total)).toBe(0);
  });

  it('con el tenant de otra organización, cero filas de la primera', async () => {
    const filas = await conTenantYRol(
      cliente,
      beta.tenantId,
      ROL_APLICACION,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from persona where tenant_id = ${alfa.tenantId}
      `,
    );
    expect(Number(filas[0]?.total)).toBe(0);
  });

  it('purgar una organización se lleva su identidad y deja la de la otra', async () => {
    const gamma = await sembrarOrganizacion(cliente, 'identidad-gamma');
    const usuarioGamma = await crearUsuario(
      cliente,
      gamma,
      `gamma-${uuidV7().slice(-8)}@ejemplo.local`,
    );
    await comoIdentidad(cliente, async (tx) => {
      await tx`
        insert into sesion (tenant_id, persona_id, usuario_id, token, caduca_en)
        values (${gamma.tenantId}, ${gamma.personaId}, ${usuarioGamma}, ${tokenAleatorio()},
                now() + interval '1 hour')
      `;
      await tx`
        insert into clave_acceso (usuario_id, clave_publica, credencial_id, contador,
                                  tipo_dispositivo, respaldada)
        values (${usuarioGamma}, 'clave-publica-de-prueba', ${tokenAleatorio()}, 0,
                'singleDevice', false)
      `;
    });

    const borradas = await purgarOrganizacion(cliente, gamma.tenantId);
    expect(borradas['usuario']).toBe(1);
    expect(borradas['sesion']).toBe(1);
    expect(borradas['clave_acceso']).toBe(1);

    const [restantes] = await comoIdentidad(
      cliente,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from usuario where id in (${usuarioAlfa}, ${usuarioBeta})
      `,
    );
    expect(Number(restantes?.total)).toBe(2);
  });
});
