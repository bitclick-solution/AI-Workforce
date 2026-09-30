/**
 * Ruta del perfil de la persona: hoy solo el ajuste «Mostrar mi presencia en las
 * salas» (ADR-026, rebanada «Presencia configurable desde el perfil»).
 *
 * A diferencia de `/sala` y `/contador`, no lleva bandera de funcionalidad ni
 * token propio: esas dos rutas nacieron antes de «Acceso al panel» y su token era
 * la única prueba de que quien llamaba era el servidor del panel; `/perfil` nace
 * después, ya con la sesión validada en el servidor, y exigir un token aparte solo
 * repetiría esa comprobación. El tenant y la persona salen de la sesión; una
 * petición sin sesión válida recibe 401 y ninguna fila.
 *
 * Como el contador y la sala, se parte en dos: `atenderPerfil` no sabe nada de
 * PostgreSQL y se prueba con un puerto falso; `puertoPerfilConBaseDeDatos` es el
 * de verdad, con `conTenant` y la entrada del libro en la misma transacción que el
 * cambio. La presencia en sí sigue sin guardarse: solo se audita el cambio del
 * ajuste, nunca cada conexión o desconexión.
 */
import { conTenant } from '@aiw/db';
import { anotar } from '@aiw/ledger';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';

export const PREFIJO_PERFIL = '/perfil';

/** Nombre de la acción del libro. Se añade, no se renombra: una consulta de auditoría la busca por este texto. */
export const ACCION_PRESENCIA_ACTUALIZADA = 'perfil.presencia_actualizada';

export interface PerfilDeLaVista {
  mostrarPresencia: boolean;
}

/** Lo que la ruta necesita de fuera. Se inyecta para probarla sin base de datos. */
export interface PuertoPerfil {
  leer(tenantId: string, personaId: string): Promise<PerfilDeLaVista>;
  actualizarPresencia(
    tenantId: string,
    personaId: string,
    mostrarPresencia: boolean,
  ): Promise<PerfilDeLaVista>;
}

export interface PeticionPerfil {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo?: unknown;
}

export interface RespuestaPerfil {
  estado: number;
  cuerpo: Record<string, unknown>;
  cabeceras: Record<string, string>;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaPerfil {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

function campo(cuerpo: unknown, nombre: string): unknown {
  return typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)[nombre]
    : undefined;
}

/**
 * Atiende una petición del perfil.
 *
 * Devuelve `undefined` cuando la petición no es suya: el servidor responde
 * entonces como con cualquier otra ruta que no existe.
 */
export async function atenderPerfil(
  peticion: PeticionPerfil,
  puerto: PuertoPerfil | undefined,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaPerfil | undefined> {
  const [camino = '/'] = (peticion.url ?? '/').split('?');
  if (camino !== PREFIJO_PERFIL) return undefined;
  if (!puerto) return undefined;

  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  const { tenantId, personaId } = sesion;

  if (peticion.metodo === 'GET') {
    return respuesta(200, { ...(await puerto.leer(tenantId, personaId)) });
  }

  if (peticion.metodo === 'PATCH') {
    const mostrarPresencia = campo(peticion.cuerpo, 'mostrarPresencia');
    if (typeof mostrarPresencia !== 'boolean') {
      return respuesta(400, { error: 'mostrarPresencia tiene que ser un booleano.' });
    }
    return respuesta(200, {
      ...(await puerto.actualizarPresencia(tenantId, personaId, mostrarPresencia)),
    });
  }

  return respuesta(405, { error: 'El perfil se lee con GET y se cambia con PATCH.' });
}

/** Puerto real: `conTenant` con el rol de aplicación y la entrada del libro en la misma transacción. */
export function puertoPerfilConBaseDeDatos(cliente: postgres.Sql): PuertoPerfil {
  return {
    async leer(tenantId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ mostrar_presencia: boolean }[]>`
        select mostrar_presencia from persona where tenant_id = ${tenantId} and id = ${personaId}
      `,
      );
      return { mostrarPresencia: fila?.mostrar_presencia !== false };
    },
    async actualizarPresencia(tenantId, personaId, mostrarPresencia) {
      return conTenant(cliente, tenantId, async (tx) => {
        await tx`
          update persona set mostrar_presencia = ${mostrarPresencia}, actualizado_en = clock_timestamp()
          where tenant_id = ${tenantId} and id = ${personaId}
        `;
        await anotar(tx, tenantId, {
          actorTipo: 'persona',
          actorId: personaId,
          accion: ACCION_PRESENCIA_ACTUALIZADA,
          datosReferenciados: [{ tipo: 'persona', id: personaId }],
          resultado: 'exito',
        });
        return { mostrarPresencia };
      });
    },
  };
}
