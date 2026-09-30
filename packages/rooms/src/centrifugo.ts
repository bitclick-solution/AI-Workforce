/**
 * Centrifugo solo hace fan-out (regla que no cambia, ADR-022): la verdad de un
 * mensaje o de una alta de participante vive en PostgreSQL y aquí solo se firman
 * los tokens que dejan a un cliente conectarse y suscribirse, y se llama a su API
 * HTTP para publicar una publicación efímera o preguntar quién está conectado.
 *
 * Vive en `packages/rooms` y no en `apps/api` porque lo usan los dos lados de la
 * sala: la API mintar tokens y consulta presencia al pintar los miembros, y el
 * trabajador publica cuando escribe un mensaje. El secreto HMAC y la clave de la
 * API nunca salen de quien los recibe por configuración: al navegador solo llega
 * el JWT ya firmado, de corta duración, con el canal ya restringido a esta sala de
 * este tenant. Sin acceso a canales de otra organización (criterio de hecho): el
 * canal lleva el tenant en su nombre y el token de canal lo fija, así que un token
 * válido para una sala no sirve para ninguna otra.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { canalDeSala } from './sala.js';

function base64Url(datos: Buffer | string): string {
  const buffer = typeof datos === 'string' ? Buffer.from(datos, 'utf8') : datos;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CABECERA_JWT = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function firmar(secreto: string, cargaJson: string): string {
  const cuerpo = `${CABECERA_JWT}.${base64Url(cargaJson)}`;
  const firma = createHmac('sha256', secreto).update(cuerpo).digest();
  return `${cuerpo}.${base64Url(firma)}`;
}

export interface OpcionesTokenDeConexion {
  personaId: string;
  tenantId: string;
  ttlSegundos: number;
  ahoraMs?: number | undefined;
}

/**
 * Token de conexión de Centrifugo. `sub` es la persona; `info` lleva el tenant
 * para que quede en la presencia (útil para depurar, nunca para autorizar: la
 * autorización de cada canal la da su propio token de suscripción).
 */
export function tokenDeConexion(secreto: string, opciones: OpcionesTokenDeConexion): string {
  const ahora = opciones.ahoraMs ?? Date.now();
  const carga = {
    sub: opciones.personaId,
    exp: Math.floor(ahora / 1000) + Math.max(1, Math.trunc(opciones.ttlSegundos)),
    info: { tenantId: opciones.tenantId },
  };
  return firmar(secreto, JSON.stringify(carga));
}

export interface OpcionesTokenDeCanal {
  personaId: string;
  tenantId: string;
  salaId: string;
  ttlSegundos: number;
  ahoraMs?: number | undefined;
}

/**
 * Token de suscripción, uno por canal. El canal es `sala:<tenant>:<sala>`
 * (`canalDeSala`): con el tenant dentro del propio canal, un token firmado para
 * una sala nunca deja suscribirse a la de otra organización, aunque alguien
 * intente pedirla a mano.
 */
export function tokenDeCanal(secreto: string, opciones: OpcionesTokenDeCanal): string {
  const ahora = opciones.ahoraMs ?? Date.now();
  const carga = {
    sub: opciones.personaId,
    channel: canalDeSala(opciones.tenantId, opciones.salaId),
    exp: Math.floor(ahora / 1000) + Math.max(1, Math.trunc(opciones.ttlSegundos)),
  };
  return firmar(secreto, JSON.stringify(carga));
}

/**
 * Comprueba un HMAC de Centrifugo bit a bit y no por igualdad de cadenas, igual
 * que el token de la sala v0. Se exporta solo para pruebas: la verificación de
 * verdad la hace Centrifugo, no este paquete.
 */
export function firmaValida(secreto: string, token: string): boolean {
  const partes = token.split('.');
  if (partes.length !== 3) return false;
  const [cabecera, carga, firma] = partes as [string, string, string];
  const esperada = base64Url(createHmac('sha256', secreto).update(`${cabecera}.${carga}`).digest());
  const a = Buffer.from(firma, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface ConfiguracionCentrifugo {
  /** URL base del API HTTP de Centrifugo, p. ej. http://127.0.0.1:8000. */
  urlApi: string;
  claveApi: string;
  secretoHmac: string;
}

export type BuscadorCentrifugo = (
  url: string,
  opciones: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

/**
 * Centrifugo rechazó la petición (canal desconocido, token inválido...): la API
 * HTTP responde 200 igual, con `error` en el cuerpo en vez de `result` (fallo 5:
 * antes esto se leía como «sin resultado» y se degradaba en silencio, sin que
 * nada lo distinguiera de que de verdad no había nadie conectado).
 */
export class ErrorCentrifugo extends Error {
  constructor(
    public readonly codigo: number,
    mensaje: string,
  ) {
    super(`Centrifugo rechazó la petición (${codigo}): ${mensaje}`);
    this.name = 'ErrorCentrifugo';
  }
}

async function llamarApi(
  configuracion: ConfiguracionCentrifugo,
  metodo: string,
  parametros: Record<string, unknown>,
  buscar: BuscadorCentrifugo,
): Promise<{ result?: Record<string, unknown> }> {
  const respuesta = await buscar(`${configuracion.urlApi.replace(/\/+$/, '')}/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': configuracion.claveApi },
    body: JSON.stringify({ method: metodo, params: parametros }),
  });
  const texto = await respuesta.text();
  const cuerpo =
    texto.length > 0
      ? (JSON.parse(texto) as { result?: Record<string, unknown>; error?: { code: number; message: string } })
      : {};
  if (cuerpo.error) throw new ErrorCentrifugo(cuerpo.error.code, cuerpo.error.message);
  return cuerpo;
}

/**
 * Publica una publicación efímera en el canal de la sala: mensajes nuevos y el
 * aviso de «escribiendo». Ninguna de las dos se guarda en PostgreSQL; Centrifugo
 * es aquí de verdad solo un repartidor, no una fuente.
 */
export async function publicarEnSala(
  configuracion: ConfiguracionCentrifugo,
  tenantId: string,
  salaId: string,
  datos: Record<string, unknown>,
  buscar: BuscadorCentrifugo,
): Promise<void> {
  await llamarApi(
    configuracion,
    'publish',
    { channel: canalDeSala(tenantId, salaId), data: datos },
    buscar,
  );
}

export interface PresenciaCentrifugo {
  /** Persona conectada, tal como la puso `sub` en su token de conexión. */
  personaId: string;
}

/**
 * Quién está conectado a la sala ahora mismo, según Centrifugo. Si Centrifugo no
 * responde, se propaga el error: quien llama decide el respaldo (consulta
 * periódica), no este módulo.
 */
export async function presenciaDeSala(
  configuracion: ConfiguracionCentrifugo,
  tenantId: string,
  salaId: string,
  buscar: BuscadorCentrifugo,
): Promise<PresenciaCentrifugo[]> {
  const respuesta = await llamarApi(
    configuracion,
    'presence',
    { channel: canalDeSala(tenantId, salaId) },
    buscar,
  );
  const presencia = (respuesta.result?.['presence'] ?? {}) as Record<string, { user?: string }>;
  const personas = new Set<string>();
  for (const cliente of Object.values(presencia)) {
    if (typeof cliente.user === 'string' && cliente.user.length > 0) personas.add(cliente.user);
  }
  return [...personas].map((personaId) => ({ personaId }));
}
