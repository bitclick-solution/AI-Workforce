/**
 * Ruta del perfil de la persona: el ajuste «Mostrar mi presencia en las salas»
 * (ADR-026, rebanada «Presencia configurable desde el perfil») y, desde la
 * rebanada «Inicio: widgets, agentes en tiempo real y avisos a la derecha», la
 * disposición del panel de widgets del inicio — qué widgets, en qué orden, con
 * qué tamaño y cuáles ocultos, por persona. Los dos ajustes comparten ruta porque
 * los dos son «cómo ve esta persona el panel», no un dato de negocio de la
 * organización.
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

/** Nombre de la acción del libro de la disposición del panel. Se añade, no se renombra. */
export const ACCION_DISPOSICION_ACTUALIZADA = 'perfil.disposicion_panel_actualizada';

export const TAMANOS_DE_WIDGET = ['pequeno', 'mediano', 'grande'] as const;
export type TamanoDeWidgetDelPerfil = (typeof TAMANOS_DE_WIDGET)[number];

export interface EntradaDeDisposicion {
  id: string;
  tamano: TamanoDeWidgetDelPerfil;
  oculto: boolean;
}

export interface PerfilDeLaVista {
  mostrarPresencia: boolean;
  /** Disposición del panel de widgets del inicio: qué, en qué orden, tamaño y ocultos. */
  disposicionPanel: EntradaDeDisposicion[];
}

/**
 * Valida el cuerpo de `disposicionPanel`: un array de entradas con `id` no vacío,
 * `tamano` del catálogo cerrado y `oculto` booleano. Cualquier otra cosa, `null`:
 * la ruta responde 400 en vez de guardar una disposición a medias.
 */
export function validarDisposicionPanel(valor: unknown): EntradaDeDisposicion[] | null {
  if (!Array.isArray(valor)) return null;
  const normalizada: EntradaDeDisposicion[] = [];
  for (const entrada of valor) {
    if (typeof entrada !== 'object' || entrada === null) return null;
    const { id, tamano, oculto } = entrada as Record<string, unknown>;
    if (typeof id !== 'string' || id.trim().length === 0) return null;
    if (
      typeof tamano !== 'string' ||
      !TAMANOS_DE_WIDGET.includes(tamano as TamanoDeWidgetDelPerfil)
    ) {
      return null;
    }
    if (typeof oculto !== 'boolean') return null;
    normalizada.push({ id, tamano: tamano as TamanoDeWidgetDelPerfil, oculto });
  }
  return normalizada;
}

/** Lo que la ruta necesita de fuera. Se inyecta para probarla sin base de datos. */
export interface PuertoPerfil {
  leer(tenantId: string, personaId: string): Promise<PerfilDeLaVista>;
  actualizarPresencia(
    tenantId: string,
    personaId: string,
    mostrarPresencia: boolean,
  ): Promise<PerfilDeLaVista>;
  actualizarDisposicion(
    tenantId: string,
    personaId: string,
    disposicionPanel: EntradaDeDisposicion[],
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
    const mostrarPresenciaEnviada = campo(peticion.cuerpo, 'mostrarPresencia');
    const disposicionEnviada = campo(peticion.cuerpo, 'disposicionPanel');
    const tocaPresencia = mostrarPresenciaEnviada !== undefined;
    const tocaDisposicion = disposicionEnviada !== undefined;

    if (!tocaPresencia && !tocaDisposicion) {
      return respuesta(400, {
        error: 'Manda mostrarPresencia, disposicionPanel o los dos.',
      });
    }
    if (tocaPresencia && typeof mostrarPresenciaEnviada !== 'boolean') {
      return respuesta(400, { error: 'mostrarPresencia tiene que ser un booleano.' });
    }
    const disposicionValidada = tocaDisposicion
      ? validarDisposicionPanel(disposicionEnviada)
      : undefined;
    if (tocaDisposicion && disposicionValidada === null) {
      return respuesta(400, {
        error:
          'disposicionPanel tiene que ser una lista de { id, tamano, oculto }, con tamano ' +
          `en ${TAMANOS_DE_WIDGET.join(', ')}.`,
      });
    }

    if (tocaPresencia) {
      await puerto.actualizarPresencia(tenantId, personaId, mostrarPresenciaEnviada as boolean);
    }
    if (disposicionValidada) {
      await puerto.actualizarDisposicion(tenantId, personaId, disposicionValidada);
    }
    return respuesta(200, { ...(await puerto.leer(tenantId, personaId)) });
  }

  return respuesta(405, { error: 'El perfil se lee con GET y se cambia con PATCH.' });
}

function disposicionDesdeColumna(valor: unknown): EntradaDeDisposicion[] {
  return validarDisposicionPanel(valor) ?? [];
}

/** Puerto real: `conTenant` con el rol de aplicación y la entrada del libro en la misma transacción. */
export function puertoPerfilConBaseDeDatos(cliente: postgres.Sql): PuertoPerfil {
  return {
    async leer(tenantId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ mostrar_presencia: boolean; disposicion_panel: unknown }[]>`
        select mostrar_presencia, disposicion_panel
        from persona where tenant_id = ${tenantId} and id = ${personaId}
      `,
      );
      return {
        mostrarPresencia: fila?.mostrar_presencia !== false,
        disposicionPanel: disposicionDesdeColumna(fila?.disposicion_panel),
      };
    },
    async actualizarPresencia(tenantId, personaId, mostrarPresencia) {
      return conTenant(cliente, tenantId, async (tx) => {
        const [fila] = await tx<{ disposicion_panel: unknown }[]>`
          update persona set mostrar_presencia = ${mostrarPresencia}, actualizado_en = clock_timestamp()
          where tenant_id = ${tenantId} and id = ${personaId}
          returning disposicion_panel
        `;
        await anotar(tx, tenantId, {
          actorTipo: 'persona',
          actorId: personaId,
          accion: ACCION_PRESENCIA_ACTUALIZADA,
          datosReferenciados: [{ tipo: 'persona', id: personaId }],
          resultado: 'exito',
        });
        return {
          mostrarPresencia,
          disposicionPanel: disposicionDesdeColumna(fila?.disposicion_panel),
        };
      });
    },
    async actualizarDisposicion(tenantId, personaId, disposicionPanel) {
      return conTenant(cliente, tenantId, async (tx) => {
        const [fila] = await tx<{ mostrar_presencia: boolean }[]>`
          update persona set
            disposicion_panel = ${JSON.stringify(disposicionPanel)}::text::jsonb,
            actualizado_en = clock_timestamp()
          where tenant_id = ${tenantId} and id = ${personaId}
          returning mostrar_presencia
        `;
        await anotar(tx, tenantId, {
          actorTipo: 'persona',
          actorId: personaId,
          accion: ACCION_DISPOSICION_ACTUALIZADA,
          datosReferenciados: [{ tipo: 'persona', id: personaId }],
          resultado: 'exito',
        });
        return { mostrarPresencia: fila?.mostrar_presencia !== false, disposicionPanel };
      });
    },
  };
}
