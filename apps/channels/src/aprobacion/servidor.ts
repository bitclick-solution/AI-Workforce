/**
 * El servidor del enlace de aprobación, sobre `node:http`.
 *
 * Tres rutas y ninguna dependencia de framework: la página no tiene sesión, ni
 * cookies, ni JavaScript, y el cuerpo que acepta es un formulario de un solo campo.
 * Meter un framework HTTP en el monorepo por esto sería una decisión de arquitectura
 * que el plan no pide, y la tomaría esta rebanada por todas las demás.
 *
 * Nada de lo que se registra aquí lleva el token. El token es la credencial del
 * enlace: si aparece en un registro, cualquiera con acceso a los registros puede
 * aprobar un pago. Se registra el motivo y, como mucho, la aprobación.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { CABECERAS_HTML } from '../html.js';

import {
  paginaCaducada,
  paginaDecidida,
  paginaDeDecision,
  paginaEnlaceNoValido,
  paginaYaDecidida,
  SENTIDOS_BOTON,
  type SentidoBoton,
} from './paginas.js';
import type { ServicioDeAprobacion } from './servicio.js';

/** Tamaño máximo del cuerpo. Un formulario con un campo no pasa de esto. */
export const LIMITE_CUERPO_BYTES = 4096;

const RUTA_APROBACIONES = /^\/aprobaciones\/([^/]+)\/?$/;

export interface RespuestaPreparada {
  estado: number;
  cuerpo: string;
  cabeceras: Record<string, string>;
}

function html(estado: number, cuerpo: string): RespuestaPreparada {
  return { estado, cuerpo, cabeceras: { ...CABECERAS_HTML } };
}

function json(estado: number, cuerpo: unknown): RespuestaPreparada {
  return {
    estado,
    cuerpo: JSON.stringify(cuerpo),
    cabeceras: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  };
}

/**
 * Traduce lo que devuelve el servicio a una página y un código.
 *
 * Los códigos importan porque los lee un monitor: `410` es «existió y ya no vale»,
 * `404` es «no hay nada que ver aquí», y el `200` de «ya se usó» es informativo,
 * porque la aprobación sí existe y está resuelta.
 */
export async function atenderApertura(
  servicio: ServicioDeAprobacion,
  token: string,
): Promise<RespuestaPreparada> {
  const vista = await servicio.abrirEnlace(token);
  switch (vista.estado) {
    case 'mostrar':
      return html(
        200,
        paginaDeDecision({
          resumenLegible: vista.aprobacion.resumenLegible,
          claseAccion: vista.aprobacion.claseAccion,
          nivelExigido: vista.aprobacion.nivelExigido,
          venceEn: vista.aprobacion.venceEn,
          accion: `/aprobaciones/${encodeURIComponent(vista.token)}`,
        }),
      );
    case 'caducado':
      return html(410, paginaCaducada(vista.venceEn));
    case 'ya_decidida':
      return html(200, paginaYaDecidida(vista.sentido));
    case 'no_valido':
      return html(404, paginaEnlaceNoValido());
  }
}

export async function atenderDecision(
  servicio: ServicioDeAprobacion,
  token: string,
  boton: SentidoBoton,
): Promise<RespuestaPreparada> {
  const resultado = await servicio.decidir(token, boton);
  switch (resultado.estado) {
    case 'decidida':
      return html(200, paginaDecidida(resultado.sentido));
    case 'caducado':
      return html(410, paginaCaducada(resultado.venceEn));
    case 'ya_decidida':
      return html(200, paginaYaDecidida(resultado.sentido));
    case 'no_valido':
      return html(404, paginaEnlaceNoValido());
  }
}

/** Lee el cuerpo con límite. Un cuerpo más largo se corta y no se interpreta. */
export async function leerCuerpo(peticion: IncomingMessage): Promise<string> {
  const trozos: Buffer[] = [];
  let tamano = 0;
  for await (const trozo of peticion) {
    const bloque = Buffer.isBuffer(trozo) ? trozo : Buffer.from(String(trozo));
    tamano += bloque.length;
    if (tamano > LIMITE_CUERPO_BYTES) {
      throw new ErrorCuerpoDemasiadoGrande();
    }
    trozos.push(bloque);
  }
  return Buffer.concat(trozos).toString('utf8');
}

export class ErrorCuerpoDemasiadoGrande extends Error {
  constructor() {
    super('El cuerpo de la petición pasa del límite.');
    this.name = 'ErrorCuerpoDemasiadoGrande';
  }
}

/** El único campo del formulario. Cualquier otro valor no decide nada. */
export function botonDelCuerpo(cuerpo: string): SentidoBoton | null {
  const sentido = new URLSearchParams(cuerpo).get('sentido');
  if (sentido === SENTIDOS_BOTON.aprobar) return SENTIDOS_BOTON.aprobar;
  if (sentido === SENTIDOS_BOTON.rechazar) return SENTIDOS_BOTON.rechazar;
  return null;
}

export async function enrutar(
  servicio: ServicioDeAprobacion,
  peticion: IncomingMessage,
): Promise<RespuestaPreparada> {
  const ruta = new URL(peticion.url ?? '/', 'http://interno').pathname;
  const metodo = (peticion.method ?? 'GET').toUpperCase();

  if (ruta === '/salud') {
    if (metodo !== 'GET' && metodo !== 'HEAD') return json(405, { error: 'metodo_no_admitido' });
    return json(200, { estado: 'ok' });
  }

  const coincidencia = RUTA_APROBACIONES.exec(ruta);
  if (!coincidencia) return html(404, paginaEnlaceNoValido());

  const token = decodeURIComponent(coincidencia[1] ?? '');
  if (metodo === 'GET') return atenderApertura(servicio, token);
  if (metodo !== 'POST') {
    return {
      ...html(405, paginaEnlaceNoValido()),
      cabeceras: { ...CABECERAS_HTML, allow: 'GET, POST' },
    };
  }

  const boton = botonDelCuerpo(await leerCuerpo(peticion));
  // Sin botón no hay decisión: se vuelve a mostrar el enlace en vez de inventarse
  // un sentido. Un formulario sin campo no es una aprobación.
  if (!boton) return atenderApertura(servicio, token);
  return atenderDecision(servicio, token, boton);
}

export interface OpcionesServidor {
  servicio: ServicioDeAprobacion;
  puerto: number;
  host?: string | undefined;
}

export interface ServidorEnMarcha {
  servidor: Server;
  puerto: number;
  cerrar: () => Promise<void>;
}

export function crearServidor(servicio: ServicioDeAprobacion): Server {
  return createServer((peticion, respuesta) => {
    void responder(servicio, peticion, respuesta);
  });
}

async function responder(
  servicio: ServicioDeAprobacion,
  peticion: IncomingMessage,
  respuesta: ServerResponse,
): Promise<void> {
  try {
    const preparada = await enrutar(servicio, peticion);
    respuesta.writeHead(preparada.estado, preparada.cabeceras);
    respuesta.end(peticion.method === 'HEAD' ? undefined : preparada.cuerpo);
  } catch (error) {
    // Cualquier fallo inesperado —la base caída, un tenant purgado— sale como la
    // página genérica. Al registro va el error, nunca el token ni la ruta completa.
    console.error('[channels] fallo al atender una aprobación:', textoSeguro(error));
    respuesta.writeHead(500, { ...CABECERAS_HTML });
    respuesta.end(paginaEnlaceNoValido());
  }
}

function textoSeguro(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido';
}

export async function arrancarServidor(opciones: OpcionesServidor): Promise<ServidorEnMarcha> {
  const servidor = crearServidor(opciones.servicio);
  await new Promise<void>((listo, fallo) => {
    servidor.once('error', fallo);
    servidor.listen(opciones.puerto, opciones.host ?? '127.0.0.1', () => {
      servidor.removeListener('error', fallo);
      listo();
    });
  });
  const direccion = servidor.address();
  return {
    servidor,
    puerto: typeof direccion === 'object' && direccion ? direccion.port : opciones.puerto,
    cerrar: () =>
      new Promise<void>((listo, fallo) => {
        servidor.close((error) => (error ? fallo(error) : listo()));
      }),
  };
}
