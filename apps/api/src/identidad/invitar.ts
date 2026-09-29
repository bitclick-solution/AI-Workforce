/**
 * Invitación del propietario de una organización: la única puerta de alta.
 *
 * Durante la alfa no hay registro abierto. Bitclick invita: crea (o reutiliza) la
 * organización, la persona propietaria y su usuario, y anota la invitación en el
 * libro de la organización. Todo en una transacción: o queda todo o nada.
 *
 * La transacción cambia de rol dos veces a propósito. Organización, persona y
 * libro se escriben como `aiw_app` con el tenant fijado, igual que cualquier
 * escritura de negocio; el usuario, como `aiw_identidad`, el único rol que puede
 * tocar la identidad. Quien ejecuta el comando necesita poder asumir los dos.
 *
 * El aviso por correo va después de confirmar: si el correo falla, la invitación
 * existe igual y la persona puede pedir su enlace desde `/acceso`.
 */
import { ROL_APLICACION, ROL_IDENTIDAD, AJUSTE_TENANT, identificadorSeguro, uuidV7 } from '@aiw/db';
import type { PuertoDeCorreo } from '@aiw/domain';
import { anotar } from '@aiw/ledger';
import type postgres from 'postgres';

import { ACCIONES_ACCESO } from './auditoria.js';
import { correoDeInvitacion } from './correo.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Invitacion {
  /** Nombre de una organización nueva. Excluye a `tenantId`. */
  organizacion?: string | undefined;
  /** Organización existente. Excluye a `organizacion`. */
  tenantId?: string | undefined;
  nombre: string;
  correo: string;
}

export interface InvitacionHecha {
  tenantId: string;
  personaId: string;
  usuarioId: string;
  organizacion: string;
}

export class InvitacionNoValida extends Error {}

export function validarInvitacion(
  invitacion: Invitacion,
): Required<Pick<Invitacion, 'nombre' | 'correo'>> & Invitacion {
  const nombre = invitacion.nombre.trim();
  const correo = invitacion.correo.trim().toLowerCase();
  if (nombre.length === 0) throw new InvitacionNoValida('Falta el nombre de la persona.');
  if (!CORREO.test(correo)) throw new InvitacionNoValida('El correo no parece un correo.');
  const conOrganizacion = (invitacion.organizacion ?? '').trim().length > 0;
  const conTenant = (invitacion.tenantId ?? '').trim().length > 0;
  if (conOrganizacion === conTenant) {
    throw new InvitacionNoValida(
      'Indica una organización nueva o un tenant existente, uno de los dos.',
    );
  }
  if (conTenant && !UUID.test(invitacion.tenantId ?? '')) {
    throw new InvitacionNoValida('El tenant tiene que ser un UUID.');
  }
  return { ...invitacion, nombre, correo, organizacion: invitacion.organizacion?.trim() };
}

/** Crea organización (si hace falta), persona y usuario, y lo anota. */
export async function invitarPropietario(
  cliente: postgres.Sql,
  entrada: Invitacion,
): Promise<InvitacionHecha> {
  const invitacion = validarInvitacion(entrada);
  const tenantId = invitacion.tenantId ?? uuidV7();
  const usuarioId = uuidV7();

  return cliente.begin(async (tx) => {
    await tx.unsafe(`set local role ${identificadorSeguro(ROL_APLICACION)}`);
    await tx`select set_config(${AJUSTE_TENANT}, ${tenantId}, true)`;

    let organizacion: string;
    if (invitacion.tenantId) {
      const [fila] = await tx<{ nombre: string; estado: string }[]>`
        select nombre, estado from organizacion where id = ${tenantId}
      `;
      if (!fila) throw new InvitacionNoValida('Esa organización no existe.');
      if (fila.estado !== 'activa')
        throw new InvitacionNoValida('Esa organización no está activa.');
      organizacion = fila.nombre;
    } else {
      organizacion = invitacion.organizacion ?? '';
      await tx`insert into organizacion (id, nombre) values (${tenantId}, ${organizacion})`;
    }

    const [existente] = await tx<{ id: string }[]>`
      select id from persona where tenant_id = ${tenantId} and correo = ${invitacion.correo}
    `;
    let personaId: string;
    if (existente) {
      personaId = existente.id;
      await tx`update persona set activa = true, actualizado_en = now() where id = ${personaId}`;
    } else {
      const [nueva] = await tx<{ id: string }[]>`
        insert into persona (tenant_id, nombre, correo)
        values (${tenantId}, ${invitacion.nombre}, ${invitacion.correo})
        returning id
      `;
      if (!nueva) throw new Error('La persona no se insertó.');
      personaId = nueva.id;
    }

    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      accion: ACCIONES_ACCESO.propietarioInvitado,
      datosReferenciados: [
        { tipo: 'persona', id: personaId },
        { tipo: 'usuario', id: usuarioId },
      ],
      resultado: 'exito',
    });

    await tx.unsafe(`set local role ${identificadorSeguro(ROL_IDENTIDAD)}`);
    try {
      await tx`
        insert into usuario (id, tenant_id, persona_id, nombre, correo)
        values (${usuarioId}, ${tenantId}, ${personaId}, ${invitacion.nombre}, ${invitacion.correo})
      `;
    } catch (error) {
      if ((error as { code?: unknown }).code === '23505') {
        throw new InvitacionNoValida('Ese correo o esa persona ya tienen acceso.');
      }
      throw error;
    }

    return { tenantId, personaId, usuarioId, organizacion };
  }) as Promise<InvitacionHecha>;
}

/** Manda el aviso de invitación. Se llama después de confirmar la transacción. */
export async function avisarInvitacion(
  correo: PuertoDeCorreo,
  remitente: string,
  urlPublica: string,
  invitacion: Invitacion,
  hecha: InvitacionHecha,
): Promise<void> {
  const urlAcceso = new URL('/acceso', urlPublica).toString();
  await correo.enviar(
    correoDeInvitacion(
      remitente,
      invitacion.correo.trim().toLowerCase(),
      invitacion.nombre.trim(),
      hecha.organizacion,
      urlAcceso,
    ),
  );
}
