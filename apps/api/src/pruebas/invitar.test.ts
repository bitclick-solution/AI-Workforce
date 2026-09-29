/**
 * La invitación del propietario contra PostgreSQL: todo o nada, con su entrada en
 * el libro y sin duplicar a nadie.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import { aplicarMigraciones, conTenant, purgarOrganizacion, uuidV7 } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from '@aiw/db/pruebas';
import { verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACCIONES_ACCESO } from '../identidad/auditoria';
import { CorreoEnMemoria } from '../identidad/correo';
import { InvitacionNoValida, avisarInvitacion, invitarPropietario } from '../identidad/invitar';

const TITULO = HAY_BASE_DE_DATOS
  ? 'invitación del propietario'
  : `invitación del propietario — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  const tenants: string[] = [];
  const sufijo = uuidV7().slice(-12);

  beforeAll(async () => {
    cliente = conectar(2);
    await aplicarMigraciones(cliente);
  });

  afterAll(async () => {
    for (const tenantId of tenants) await purgarOrganizacion(cliente, tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('crea organización, persona y usuario, lo anota y avisa por correo', async () => {
    const invitacion = {
      organizacion: `Asesoría ${sufijo}`,
      nombre: 'Marta Olmo',
      correo: `Marta-${sufijo}@Olmo.example`,
    };
    const hecha = await invitarPropietario(cliente, invitacion);
    tenants.push(hecha.tenantId);

    const [persona] = await conTenant(
      cliente,
      hecha.tenantId,
      (tx) => tx<{ correo: string }[]>`
      select correo from persona where id = ${hecha.personaId}
    `,
    );
    expect(persona?.correo).toBe(`marta-${sufijo}@olmo.example`);
    const [usuario] = await cliente<{ tenant_id: string; persona_id: string }[]>`
      select tenant_id, persona_id from usuario where id = ${hecha.usuarioId}
    `;
    expect(usuario).toEqual({ tenant_id: hecha.tenantId, persona_id: hecha.personaId });

    const acciones = await conTenant(
      cliente,
      hecha.tenantId,
      (tx) => tx<{ accion: string; actor_tipo: string }[]>`
      select accion, actor_tipo from entrada_auditoria where tenant_id = ${hecha.tenantId}
    `,
    );
    expect(acciones).toEqual([
      { accion: ACCIONES_ACCESO.propietarioInvitado, actor_tipo: 'plataforma' },
    ]);
    expect((await verificarCadenaEnBase(cliente, hecha.tenantId)).valida).toBe(true);

    const correo = new CorreoEnMemoria();
    await avisarInvitacion(correo, 'agentes@aiw.local', 'http://localhost:3000', invitacion, hecha);
    expect(correo.ultimo?.para).toBe(`marta-${sufijo}@olmo.example`);
    expect(correo.ultimo?.texto).toContain('http://localhost:3000/acceso');
  });

  it('un correo que ya tiene acceso no se invita dos veces y no deja nada a medias', async () => {
    const correoRepetido = `repetido-${sufijo}@olmo.example`;
    const primera = await invitarPropietario(cliente, {
      organizacion: `Primera ${sufijo}`,
      nombre: 'Uno',
      correo: correoRepetido,
    });
    tenants.push(primera.tenantId);

    const tenantsAntes = await cliente<{ total: string }[]>`
      select count(*) as total from organizacion where nombre = ${`Segunda ${sufijo}`}
    `;
    await expect(
      invitarPropietario(cliente, {
        organizacion: `Segunda ${sufijo}`,
        nombre: 'Dos',
        correo: correoRepetido,
      }),
    ).rejects.toThrow(InvitacionNoValida);
    const tenantsDespues = await cliente<{ total: string }[]>`
      select count(*) as total from organizacion where nombre = ${`Segunda ${sufijo}`}
    `;
    // La organización de la segunda invitación no quedó creada: la transacción entera volvió atrás.
    expect(tenantsDespues[0]?.total).toBe(tenantsAntes[0]?.total);
  });

  it('una organización que no existe no se inventa', async () => {
    await expect(
      invitarPropietario(cliente, {
        tenantId: uuidV7(),
        nombre: 'Nadie',
        correo: `nadie-${sufijo}@olmo.example`,
      }),
    ).rejects.toThrow(/no existe/);
  });
});
