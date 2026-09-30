/**
 * El puerto real del perfil contra PostgreSQL: el ajuste de presencia activado
 * por defecto, su actualización, la entrada propia en el libro y el aislamiento
 * entre organizaciones (ADR-026, rebanada «Presencia configurable desde el
 * perfil»).
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import {
  ROL_APLICACION,
  aplicarMigraciones,
  conTenant,
  crearConexion,
  purgarOrganizacion,
  uuidV7,
} from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  conectar,
  sembrarFinanzas,
} from '@aiw/db/pruebas';
import { verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACCION_PRESENCIA_ACTUALIZADA, puertoPerfilConBaseDeDatos } from '../rutas/perfil';

const TITULO = HAY_BASE_DE_DATOS
  ? 'puerto del perfil'
  : `puerto del perfil — SALTADO. ${MOTIVO_SALTO}`;

async function sembrarOrganizacion(cliente: postgres.Sql, etiqueta: string) {
  return sembrarFinanzas(cliente, {
    nombre: `Perfil puerto ${etiqueta} ${uuidV7()}`,
    conector: 'demo-cobros',
    referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
    listaBlanca: ['listar_facturas_vencidas'],
    soloCobros: true,
  });
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  const tenants: string[] = [];
  let tenantId = '';
  let personaId = '';
  let otroTenantId = '';
  let otraPersonaId = '';

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    const sembrado = await sembrarOrganizacion(cliente, 'a');
    tenantId = sembrado.tenantId;
    personaId = sembrado.personaId;
    tenants.push(tenantId);
    const otro = await sembrarOrganizacion(cliente, 'b');
    otroTenantId = otro.tenantId;
    otraPersonaId = otro.personaId;
    tenants.push(otroTenantId);
    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });
  });

  afterAll(async () => {
    await conexion?.cerrar();
    for (const t of tenants) await purgarOrganizacion(cliente, t);
    await cliente?.end({ timeout: 5 });
  });

  it('el ajuste está activado por defecto (ADR-026)', async () => {
    const puerto = puertoPerfilConBaseDeDatos(conexion.cliente);
    expect(await puerto.leer(tenantId, personaId)).toEqual({ mostrarPresencia: true });
  });

  it('actualizarPresencia guarda el cambio y anota su propia entrada en el libro', async () => {
    const puerto = puertoPerfilConBaseDeDatos(conexion.cliente);
    try {
      expect(await puerto.actualizarPresencia(tenantId, personaId, false)).toEqual({
        mostrarPresencia: false,
      });
      expect(await puerto.leer(tenantId, personaId)).toEqual({ mostrarPresencia: false });

      const acciones = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ accion: string; actor_tipo: string; actor_id: string | null }[]>`
        select accion, actor_tipo, actor_id from entrada_auditoria
        where tenant_id = ${tenantId} and accion = ${ACCION_PRESENCIA_ACTUALIZADA}
      `,
      );
      expect(acciones).toEqual([
        { accion: ACCION_PRESENCIA_ACTUALIZADA, actor_tipo: 'persona', actor_id: personaId },
      ]);
      expect((await verificarCadenaEnBase(cliente, tenantId)).valida).toBe(true);
    } finally {
      // La presencia en sí no se guarda: solo el ajuste, sin historial de cambios.
      await puerto.actualizarPresencia(tenantId, personaId, true);
    }
  });

  it('el ajuste de una persona no toca ni se lee desde otra organización', async () => {
    const puerto = puertoPerfilConBaseDeDatos(conexion.cliente);
    try {
      await puerto.actualizarPresencia(tenantId, personaId, false);
      expect(await puerto.leer(otroTenantId, otraPersonaId)).toEqual({ mostrarPresencia: true });
      // La RLS por tenant hace que no exista fila que tocar con el tenant equivocado.
      const [fila] = await conTenant(
        cliente,
        otroTenantId,
        (tx) => tx<{ mostrar_presencia: boolean }[]>`
        select mostrar_presencia from persona where tenant_id = ${otroTenantId} and id = ${otraPersonaId}
      `,
      );
      expect(fila?.mostrar_presencia).toBe(true);
    } finally {
      await puerto.actualizarPresencia(tenantId, personaId, true);
    }
  });
});
