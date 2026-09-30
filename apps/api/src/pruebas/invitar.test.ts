/**
 * La invitación del propietario contra PostgreSQL: todo o nada, con su entrada en
 * el libro y sin duplicar a nadie.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import { aplicarMigraciones, conTenant, purgarOrganizacion, uuidV7 } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from '@aiw/db/pruebas';
import { verificarCadenaEnBase } from '@aiw/ledger';
import { NOMBRE_SALA_GENERAL } from '@aiw/rooms';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACCIONES_ACCESO, ACCION_SALA_MIEMBRO_ANADIDO } from '../identidad/auditoria';
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

  it('sin sala general, la invitación no falla ni la inventa (fallo 4, fuera de alcance)', async () => {
    const hecha = await invitarPropietario(cliente, {
      organizacion: `Sin sala ${sufijo}`,
      nombre: 'Sin Sala',
      correo: `sin-sala-${sufijo}@olmo.example`,
    });
    tenants.push(hecha.tenantId);
    const salas = await conTenant(
      cliente,
      hecha.tenantId,
      (tx) => tx<{ id: string }[]>`select id from sala where tenant_id = ${hecha.tenantId}`,
    );
    expect(salas).toHaveLength(0);
  });

  it('con sala general, la persona invitada entra en ella una sola vez (fallo 4)', async () => {
    const primera = await invitarPropietario(cliente, {
      organizacion: `Con sala ${sufijo}`,
      nombre: 'Con Sala',
      correo: `con-sala-${sufijo}@olmo.example`,
    });
    tenants.push(primera.tenantId);

    const [salaGeneral] = await conTenant(
      cliente,
      primera.tenantId,
      (tx) => tx<{ id: string }[]>`
        insert into sala (tenant_id, ambito, nombre)
        values (${primera.tenantId}, 'organizacion', ${NOMBRE_SALA_GENERAL})
        returning id
      `,
    );
    if (!salaGeneral) throw new Error('la sala general no se insertó.');
    const salaGeneralId = salaGeneral.id;

    const correoInvitada = `invitada-${sufijo}@olmo.example`;
    const invitada = await invitarPropietario(cliente, {
      tenantId: primera.tenantId,
      nombre: 'Persona Invitada',
      correo: correoInvitada,
    });

    async function participantes() {
      return conTenant(
        cliente,
        primera.tenantId,
        (tx) => tx<{ persona_id: string; rol: string }[]>`
          select persona_id, rol from sala_participante
          where tenant_id = ${primera.tenantId} and sala_id = ${salaGeneralId}
        `,
      );
    }

    expect(await participantes()).toEqual([{ persona_id: invitada.personaId, rol: 'humano' }]);
    const acciones = await conTenant(
      cliente,
      primera.tenantId,
      (tx) => tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${primera.tenantId} and accion = ${ACCION_SALA_MIEMBRO_ANADIDO}
      `,
    );
    expect(acciones).toHaveLength(1);

    // Invitar otra vez al mismo correo (reactivación) no duplica el participante ni la auditoría.
    await invitarPropietario(cliente, {
      tenantId: primera.tenantId,
      nombre: 'Persona Invitada',
      correo: correoInvitada,
    });
    expect(await participantes()).toEqual([{ persona_id: invitada.personaId, rol: 'humano' }]);
    const accionesTrasRepetir = await conTenant(
      cliente,
      primera.tenantId,
      (tx) => tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${primera.tenantId} and accion = ${ACCION_SALA_MIEMBRO_ANADIDO}
      `,
    );
    expect(accionesTrasRepetir).toHaveLength(1);
  });
});
