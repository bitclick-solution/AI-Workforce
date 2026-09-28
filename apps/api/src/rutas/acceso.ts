/**
 * Ruta del acceso: `/api/auth/*` es Better Auth.
 *
 * El servidor de la API es `node:http` crudo y Better Auth habla `Request` y
 * `Response` de la web. Este módulo traduce en los dos sentidos y nada más: no
 * decide nada del acceso. Lo que llega aquí lo reenvía el panel, que es el único
 * que el navegador ve; la URL pública con la que Better Auth firma los enlaces y
 * comprueba el origen es la del panel, no la de la API.
 *
 * Detrás de `AIW_ACCESO_PANEL`: apagada, la ruta no existe y el servidor responde
 * 404 como a cualquier otra.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { RUTA_ACCESO } from '../identidad/acceso.js';

/** Tope del cuerpo: un reto de WebAuthn o un correo caben de sobra. */
export const TOPE_CUERPO_ACCESO = 64 * 1024;

export function esRutaDeAcceso(url: string | undefined): boolean {
  const camino = (url ?? '/').split('?')[0] ?? '/';
  return camino === RUTA_ACCESO || camino.startsWith(`${RUTA_ACCESO}/`);
}

export class CuerpoDemasiadoGrande extends Error {
  constructor() {
    super('El cuerpo de la petición pasa del tope.');
  }
}

/** Convierte la petición de Node en una `Request` de la web para Better Auth. */
export async function aPeticionWeb(peticion: IncomingMessage): Promise<Request> {
  const cabeceras = new Headers();
  for (const [nombre, valor] of Object.entries(peticion.headers)) {
    if (valor === undefined) continue;
    for (const v of Array.isArray(valor) ? valor : [valor]) cabeceras.append(nombre, v);
  }
  const metodo = peticion.method ?? 'GET';
  let cuerpo: Buffer | undefined;
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    const trozos: Buffer[] = [];
    let tamano = 0;
    for await (const trozo of peticion) {
      const buffer = trozo as Buffer;
      tamano += buffer.length;
      if (tamano > TOPE_CUERPO_ACCESO) throw new CuerpoDemasiadoGrande();
      trozos.push(buffer);
    }
    cuerpo = Buffer.concat(trozos);
  }
  const anfitrion = peticion.headers.host ?? 'localhost';
  return new Request(new URL(peticion.url ?? '/', `http://${anfitrion}`), {
    method: metodo,
    headers: cabeceras,
    ...(cuerpo === undefined ? {} : { body: new Uint8Array(cuerpo) }),
  });
}

/** Escribe la `Response` de Better Auth en la respuesta de Node, con cada `set-cookie`. */
export async function escribirRespuestaWeb(
  respuesta: Response,
  destino: ServerResponse,
): Promise<void> {
  const cabeceras: Record<string, string | string[]> = {};
  respuesta.headers.forEach((valor, nombre) => {
    if (nombre === 'set-cookie') return;
    cabeceras[nombre] = valor;
  });
  const cookies = respuesta.headers.getSetCookie();
  if (cookies.length > 0) cabeceras['set-cookie'] = cookies;
  cabeceras['cache-control'] = 'no-store';
  destino.writeHead(respuesta.status, cabeceras);
  destino.end(Buffer.from(await respuesta.arrayBuffer()));
}
