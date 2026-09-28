/**
 * Rutas de lectura del contador de tareas v0.
 *
 * Tres `GET` detrás de bandera de funcionalidad: consumo del periodo, tareas raíz
 * del periodo y coste por puesto. Solo lectura: esta rebanada no escribe nada por
 * HTTP, así que no hay aprobación que pedir ni política que evaluar.
 *
 * El módulo se parte en dos a propósito:
 *   - `atenderContador` no sabe nada de PostgreSQL ni de `node:http`: recibe una
 *     petición ya leída y un lector, y devuelve estado y cuerpo. Se prueba sin base
 *     de datos y sin abrir puertos.
 *   - `lectorConBaseDeDatos` es el lector real: abre una transacción con el tenant
 *     fijado, así que el aislamiento lo impone la política de RLS y no un `where`
 *     que alguien pueda olvidar.
 *
 * Identidad: el tenant sale de la sesión del panel que la API valida en el servidor
 * («Acceso al panel»), nunca de una cabecera ni de un parámetro. Sin sesión, 401 y
 * ninguna lectura. La bandera sigue exigiendo además el token en el entorno, que es
 * lo que prueba que quien llama es el servidor del panel.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { conTenant } from '@aiw/db';
import {
  consumoDelPeriodo,
  costePorPuesto,
  tareasDelPeriodo,
  type ConsumoDelPeriodo,
  type CostePorPuesto,
  type TareasDelPeriodo,
} from '@aiw/ledger';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';

/** Bandera de funcionalidad de la rebanada. Apagada, la API no expone el contador. */
export const BANDERA = 'AIW_CONTADOR_V0';

/** Token de lectura. Sin él en el entorno, la ruta no se activa ni con la bandera. */
export const VARIABLE_AUTORIZACION = 'AIW_CONTADOR_TOKEN';

export const PREFIJO = '/contador';

const LIMITE_TAREAS_POR_DEFECTO = 20;

export interface ConfiguracionContador {
  token: string;
  limiteTareas: number;
}

/**
 * Configuración desde el entorno, o `undefined` si la ruta no debe existir.
 *
 * Dos condiciones y las dos explícitas: la bandera puesta y el token presente. Un
 * token vacío no vale: sería una API abierta con la apariencia de estar protegida.
 */
export function configuracionDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionContador | undefined {
  if (entorno[BANDERA] !== '1' && entorno[BANDERA] !== 'true') return undefined;
  const token = entorno[VARIABLE_AUTORIZACION]?.trim();
  if (!token) return undefined;
  const limite = Number(entorno['AIW_CONTADOR_LIMITE_TAREAS'] ?? LIMITE_TAREAS_POR_DEFECTO);
  return {
    token,
    limiteTareas:
      Number.isFinite(limite) && limite > 0 ? Math.trunc(limite) : LIMITE_TAREAS_POR_DEFECTO,
  };
}

/** Lo que la ruta necesita saber leer. Se inyecta para poder probarla sin base. */
export interface LectorDelContador {
  consumo(tenantId: string): Promise<ConsumoDelPeriodo>;
  tareas(tenantId: string, limite: number): Promise<TareasDelPeriodo>;
  porPuesto(tenantId: string): Promise<CostePorPuesto[]>;
}

export interface PeticionContador {
  metodo: string | undefined;
  /** Ruta con su cadena de consulta, tal como llega en `req.url`. */
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
}

export interface RespuestaContador {
  estado: number;
  cuerpo: Record<string, unknown>;
  cabeceras: Record<string, string>;
}

function cabecera(peticion: PeticionContador, nombre: string): string | undefined {
  const valor = peticion.cabeceras[nombre] ?? peticion.cabeceras[nombre.toLowerCase()];
  if (Array.isArray(valor)) return valor[0];
  return valor;
}

/**
 * Compara el token sin que el tiempo de respuesta cuente cómo de parecido era.
 *
 * Se comparan los resúmenes y no las cadenas: así la comparación es de longitud fija
 * y `timingSafeEqual` no se queja cuando los tamaños no coinciden, que es
 * precisamente lo que no queremos que se filtre.
 */
function tokenCorrecto(esperado: string, recibido: string | undefined): boolean {
  if (!recibido) return false;
  const a = createHash('sha256').update(esperado, 'utf8').digest();
  const b = createHash('sha256').update(recibido, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function tokenDeLaPeticion(peticion: PeticionContador): string | undefined {
  const autorizacion = cabecera(peticion, 'authorization');
  if (!autorizacion) return undefined;
  const [tipo, ...resto] = autorizacion.trim().split(/\s+/);
  if (tipo?.toLowerCase() !== 'bearer') return undefined;
  const token = resto.join(' ').trim();
  return token.length > 0 ? token : undefined;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaContador {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

/**
 * Atiende una petición del contador.
 *
 * Devuelve `undefined` cuando la petición no es suya: el servidor responde entonces
 * como con cualquier otra ruta que no existe. Con la bandera apagada, todo lo que
 * cuelga de `/contador` también es `undefined`, así que la API no confirma ni
 * desmiente que la funcionalidad exista.
 */
export async function atenderContador(
  peticion: PeticionContador,
  configuracion: ConfiguracionContador | undefined,
  lector: LectorDelContador,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaContador | undefined> {
  const url = peticion.url ?? '/';
  const [camino = '/', consulta = ''] = url.split('?');
  if (camino !== PREFIJO && !camino.startsWith(`${PREFIJO}/`)) return undefined;
  if (!configuracion) return undefined;

  if (peticion.metodo !== 'GET') {
    return respuesta(405, { error: 'El contador solo se lee.' });
  }

  if (!tokenCorrecto(configuracion.token, tokenDeLaPeticion(peticion))) {
    return {
      estado: 401,
      cuerpo: { error: 'Falta el token de lectura del contador o no es el que toca.' },
      cabeceras: { ...SIN_CACHE, 'www-authenticate': 'Bearer' },
    };
  }

  // El tenant es el de la sesión validada en el servidor. Una cabecera
  // `x-aiw-tenant` que llegue se ignora: el cliente no decide qué organización ve.
  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) {
    return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  }
  const { tenantId } = sesion;

  const parametros = new URLSearchParams(consulta);
  const limitePedido = Number(parametros.get('limite') ?? configuracion.limiteTareas);
  const limite =
    Number.isFinite(limitePedido) && limitePedido > 0
      ? Math.trunc(limitePedido)
      : configuracion.limiteTareas;

  switch (camino) {
    case `${PREFIJO}/periodo`:
      return respuesta(200, { ...(await lector.consumo(tenantId)) });
    case `${PREFIJO}/tareas`:
      return respuesta(200, { ...(await lector.tareas(tenantId, limite)) });
    case `${PREFIJO}/coste-por-puesto`:
      return respuesta(200, { puestos: await lector.porPuesto(tenantId) });
    default:
      return respuesta(404, { error: 'Esa ruta del contador no existe.' });
  }
}

/**
 * Lector real: una transacción por petición con `aiw.tenant_id` fijado.
 *
 * El tenant se fija en la transacción y se deshace al terminar, así que una conexión
 * reutilizada del pool no arrastra el tenant de la petición anterior.
 */
export function lectorConBaseDeDatos(cliente: postgres.Sql): LectorDelContador {
  return {
    consumo: (tenantId) => conTenant(cliente, tenantId, (tx) => consumoDelPeriodo(tx, tenantId)),
    tareas: (tenantId, limite) =>
      conTenant(cliente, tenantId, (tx) => tareasDelPeriodo(tx, tenantId, limite)),
    porPuesto: (tenantId) => conTenant(cliente, tenantId, (tx) => costePorPuesto(tx, tenantId)),
  };
}
