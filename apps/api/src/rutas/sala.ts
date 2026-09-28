/**
 * Rutas de la sala v0: leer la sala general, escribir en ella y decidir una
 * propuesta de operación con un clic.
 *
 * Detrás de bandera y token, igual que el contador: sin `AIW_SALA_V0=1` y sin
 * `AIW_SALA_TOKEN`, las rutas no existen. El tenant y la persona salen de la sesión
 * del panel que la API valida en el servidor («Acceso al panel»); una cabecera que
 * diga otra cosa se ignora.
 *
 * Escribir no escribe: arranca el flujo `mensajeDeSala` o señala el de la
 * propuesta. Toda escritura la hace el trabajador dentro de una actividad, con su
 * entrada en el libro. Así la API no es un segundo punto de escritura de nada.
 *
 * Como el contador, se parte en dos: `atenderSala` no sabe de PostgreSQL ni de
 * Temporal y se prueba con un puerto falso; `puertoSala` es el de verdad.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { conTenant, uuidV7 } from '@aiw/db';
import {
  FLUJO_MENSAJE_DE_SALA,
  LONGITUD_MAXIMA_MENSAJE,
  NOMBRE_SALA_GENERAL,
  SENAL_DECISION_PROPUESTA,
  idFlujoMensaje,
  idFlujoPropuesta,
  type CargaDecisionPropuesta,
  type EntradaMensajeDeSala,
} from '@aiw/rooms';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';
import type { RespuestaContador } from './contador.js';

export const BANDERA_SALA = 'AIW_SALA_V0';
export const VARIABLE_TOKEN_SALA = 'AIW_SALA_TOKEN';
export const PREFIJO_SALA = '/sala';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_MENSAJES = 100;

export interface ConfiguracionSala {
  token: string;
  temporal: { direccion: string; espacio: string; cola: string };
}

export function configuracionSalaDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionSala | undefined {
  if (entorno[BANDERA_SALA] !== '1' && entorno[BANDERA_SALA] !== 'true') return undefined;
  const token = entorno[VARIABLE_TOKEN_SALA]?.trim();
  if (!token) return undefined;
  return {
    token,
    temporal: {
      direccion: entorno['AIW_TEMPORAL_DIRECCION']?.trim() || 'localhost:7233',
      espacio: entorno['AIW_TEMPORAL_ESPACIO']?.trim() || 'default',
      cola: entorno['AIW_TEMPORAL_COLA']?.trim() || 'aiw-prueba-stack',
    },
  };
}

export interface MensajeDeLaVista {
  id: string;
  cuerpo: string;
  autor: { tipo: 'persona' | 'puesto' | 'plataforma'; nombre: string };
  adjuntos: unknown[];
  creadoEn: string;
}

export interface PropuestaDeLaVista {
  id: string;
  resumen: string;
  estado: string;
  nivelExigido: string;
  costeEstimadoEuros: number;
  efectos: unknown;
}

/** Lo que la ruta necesita de fuera. Se inyecta para probarla sin base ni Temporal. */
export interface PuertoSala {
  salaGeneral(tenantId: string): Promise<string | null>;
  personaActiva(tenantId: string, personaId: string): Promise<boolean>;
  mensajes(tenantId: string, salaId: string, limite: number): Promise<MensajeDeLaVista[]>;
  propuestas(tenantId: string, ids: string[]): Promise<PropuestaDeLaVista[]>;
  arrancarMensaje(entrada: EntradaMensajeDeSala): Promise<void>;
  decidirPropuesta(propuestaId: string, carga: CargaDecisionPropuesta): Promise<void>;
}

export interface PeticionSala {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo?: unknown;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaContador {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

function cabecera(peticion: PeticionSala, nombre: string): string | undefined {
  const valor = peticion.cabeceras[nombre];
  return (Array.isArray(valor) ? valor[0] : valor)?.trim();
}

function tokenCorrecto(esperado: string, peticion: PeticionSala): boolean {
  const [tipo, ...resto] = (cabecera(peticion, 'authorization') ?? '').split(/\s+/);
  const recibido = resto.join(' ').trim();
  if (tipo?.toLowerCase() !== 'bearer' || recibido.length === 0) return false;
  const a = createHash('sha256').update(esperado, 'utf8').digest();
  const b = createHash('sha256').update(recibido, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function campo(cuerpo: unknown, nombre: string): unknown {
  return typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)[nombre]
    : undefined;
}

export async function atenderSala(
  peticion: PeticionSala,
  configuracion: ConfiguracionSala | undefined,
  puerto: PuertoSala,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaContador | undefined> {
  const camino = (peticion.url ?? '/').split('?')[0] ?? '/';
  if (camino !== PREFIJO_SALA && !camino.startsWith(`${PREFIJO_SALA}/`)) return undefined;
  if (!configuracion) return undefined;

  if (!tokenCorrecto(configuracion.token, peticion)) {
    return {
      estado: 401,
      cuerpo: { error: 'Falta el token de la sala o no es el que toca.' },
      cabeceras: { ...SIN_CACHE, 'www-authenticate': 'Bearer' },
    };
  }
  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  const { tenantId, personaId } = sesion;
  if (!(await puerto.personaActiva(tenantId, personaId))) {
    return respuesta(403, { error: 'La persona no está activa en esta organización.' });
  }
  const salaId = await puerto.salaGeneral(tenantId);
  if (!salaId) return respuesta(404, { error: 'La organización no tiene sala general.' });

  if (camino === PREFIJO_SALA) {
    if (peticion.metodo !== 'GET') return respuesta(405, { error: 'La sala se lee con GET.' });
    const mensajes = await puerto.mensajes(tenantId, salaId, LIMITE_MENSAJES);
    const ids = [
      ...new Set(
        mensajes.flatMap((m) =>
          m.adjuntos
            .map((a) => campo(a, 'propuestaId'))
            .filter((id): id is string => typeof id === 'string'),
        ),
      ),
    ];
    return respuesta(200, { salaId, mensajes, propuestas: await puerto.propuestas(tenantId, ids) });
  }

  if (camino === `${PREFIJO_SALA}/mensajes`) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se escribe con POST.' });
    const texto = campo(peticion.cuerpo, 'texto');
    if (typeof texto !== 'string' || texto.trim().length === 0) {
      return respuesta(400, { error: 'Falta el texto del mensaje.' });
    }
    if (texto.length > LONGITUD_MAXIMA_MENSAJE) {
      return respuesta(413, {
        error: `El mensaje pasa de ${LONGITUD_MAXIMA_MENSAJE} caracteres.`,
      });
    }
    const mensajeId = uuidV7();
    await puerto.arrancarMensaje({ tenantId, salaId, mensajeId, personaId, texto: texto.trim() });
    return respuesta(202, { mensajeId });
  }

  const decision = /^\/sala\/propuestas\/([^/]+)\/decision$/.exec(camino);
  if (decision) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se decide con POST.' });
    const propuestaId = decision[1] ?? '';
    const sentido = campo(peticion.cuerpo, 'sentido');
    if (!UUID.test(propuestaId) || (sentido !== 'aprobada' && sentido !== 'rechazada')) {
      return respuesta(400, {
        error: 'Hace falta una propuesta válida y sentido aprobada o rechazada.',
      });
    }
    const [propuesta] = await puerto.propuestas(tenantId, [propuestaId]);
    if (!propuesta) return respuesta(404, { error: 'Esa propuesta no existe.' });
    if (propuesta.estado !== 'pendiente') {
      return respuesta(409, { error: `La propuesta ya está ${propuesta.estado}.` });
    }
    await puerto.decidirPropuesta(propuestaId, { personaId, sentido });
    return respuesta(202, { propuestaId, sentido });
  }

  return respuesta(404, { error: 'Esa ruta de la sala no existe.' });
}

/** Cliente de Temporal mínimo que usa la ruta. Se inyecta para no abrir conexión al importar. */
export interface ClienteDeFlujos {
  arrancar(nombre: string, opciones: { cola: string; id: string; args: unknown[] }): Promise<void>;
  senalar(id: string, senal: string, carga: unknown): Promise<void>;
}

/** Puerto real: lecturas con el tenant fijado en la transacción y flujos por nombre. */
export function puertoSala(
  cliente: postgres.Sql,
  flujos: ClienteDeFlujos,
  configuracion: ConfiguracionSala,
): PuertoSala {
  return {
    async salaGeneral(tenantId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ id: string }[]>`
        select id from sala where tenant_id = ${tenantId} and nombre = ${NOMBRE_SALA_GENERAL}
      `,
      );
      return fila?.id ?? null;
    },
    async personaActiva(tenantId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ activa: boolean }[]>`
        select activa from persona where tenant_id = ${tenantId} and id = ${personaId}
      `,
      );
      return fila?.activa === true;
    },
    async mensajes(tenantId, salaId, limite) {
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            cuerpo: string;
            persona: string | null;
            puesto: string | null;
            adjuntos: unknown[];
            creado_en: Date;
          }[]
        >`
        select * from (
          select m.id, m.cuerpo, pe.nombre as persona, pu.nombre as puesto, m.adjuntos, m.creado_en
          from mensaje m
          left join persona pe on pe.tenant_id = m.tenant_id and pe.id = m.autor_persona_id
          left join puesto pu on pu.tenant_id = m.tenant_id and pu.id = m.autor_puesto_id
          where m.tenant_id = ${tenantId} and m.sala_id = ${salaId}
          order by m.creado_en desc, m.id desc
          limit ${limite}
        ) ultimos order by creado_en, id
      `,
      );
      return filas.map((fila) => {
        const plataforma = fila.adjuntos
          .map((a) => campo(a, 'agente'))
          .find((agente) => typeof agente === 'string');
        const autor: MensajeDeLaVista['autor'] = fila.persona
          ? { tipo: 'persona', nombre: fila.persona }
          : fila.puesto
            ? { tipo: 'puesto', nombre: fila.puesto }
            : {
                tipo: 'plataforma',
                nombre: plataforma === 'moderador' ? 'Moderador' : 'Director de IA',
              };
        return {
          id: fila.id,
          cuerpo: fila.cuerpo,
          autor,
          // `decisionCompleta` es para el reintento del flujo, no para la vista.
          adjuntos: fila.adjuntos.map((a) => {
            if (typeof a !== 'object' || a === null) return a;
            const { decisionCompleta: _omitida, ...resto } = a as Record<string, unknown>;
            return resto;
          }),
          creadoEn: fila.creado_en.toISOString(),
        };
      });
    },
    async propuestas(tenantId, ids) {
      if (ids.length === 0) return [];
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            resumen: string;
            estado: string;
            nivel_exigido: string;
            coste_estimado_euros: string;
            efectos_previstos: unknown;
          }[]
        >`
        select id, resumen, estado, nivel_exigido, coste_estimado_euros, efectos_previstos
        from propuesta_operacion
        where tenant_id = ${tenantId} and id in ${tx(ids)}
      `,
      );
      return filas.map((fila) => ({
        id: fila.id,
        resumen: fila.resumen,
        estado: fila.estado,
        nivelExigido: fila.nivel_exigido,
        costeEstimadoEuros: Number(fila.coste_estimado_euros),
        efectos: fila.efectos_previstos,
      }));
    },
    async arrancarMensaje(entrada) {
      await flujos.arrancar(FLUJO_MENSAJE_DE_SALA, {
        cola: configuracion.temporal.cola,
        id: idFlujoMensaje(entrada.mensajeId),
        args: [entrada],
      });
    },
    async decidirPropuesta(propuestaId, carga) {
      await flujos.senalar(idFlujoPropuesta(propuestaId), SENAL_DECISION_PROPUESTA, carga);
    },
  };
}
