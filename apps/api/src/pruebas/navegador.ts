/**
 * Un navegador mínimo para las pruebas de la API: guarda cookies, manda el origen
 * del panel y no sigue redirecciones, igual que el reenvío de Next.
 *
 * No entra en el camino de producción.
 */
import { randomBytes } from 'node:crypto';

import type { CorreoEnMemoria } from '../identidad/correo';

/** Origen del panel en las pruebas: el mismo que en local. */
export const ORIGEN_PANEL = 'http://localhost:3000';

/** Un secreto nuevo en cada ejecución: ni de juguete se escribe uno en el código. */
export function secretoDePrueba(): string {
  return randomBytes(36).toString('base64url');
}

export interface Respuesta {
  estado: number;
  cuerpo: unknown;
  cabeceras: Headers;
}

export class NavegadorDePrueba {
  readonly cookies = new Map<string, string>();

  constructor(readonly baseApi: string) {}

  cabeceraCookie(): string {
    return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
  }

  #guardar(cabeceras: Headers): void {
    for (const linea of cabeceras.getSetCookie()) {
      const [par = '', ...atributos] = linea.split(';');
      const igual = par.indexOf('=');
      const nombre = par.slice(0, igual).trim();
      const valor = par.slice(igual + 1).trim();
      const borrada =
        valor.length === 0 || atributos.some((a) => a.trim().toLowerCase() === 'max-age=0');
      if (borrada) this.cookies.delete(nombre);
      else this.cookies.set(nombre, valor);
    }
  }

  async pedir(
    ruta: string,
    opciones: { metodo?: string; cuerpo?: unknown; cabeceras?: Record<string, string> } = {},
  ): Promise<Respuesta> {
    const cabeceras: Record<string, string> = { origin: ORIGEN_PANEL, ...opciones.cabeceras };
    const cookie = this.cabeceraCookie();
    if (cookie.length > 0) cabeceras['cookie'] = cookie;
    if (opciones.cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
    const respuesta = await fetch(`${this.baseApi}${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      redirect: 'manual',
      ...(opciones.cuerpo === undefined ? {} : { body: JSON.stringify(opciones.cuerpo) }),
    });
    this.#guardar(respuesta.headers);
    const texto = await respuesta.text();
    let cuerpo: unknown = texto;
    try {
      cuerpo = texto.length > 0 ? JSON.parse(texto) : null;
    } catch {
      // No es JSON: se devuelve el texto.
    }
    return { estado: respuesta.status, cuerpo, cabeceras: respuesta.headers };
  }

  /** Pide el enlace, lo saca del correo en memoria y lo abre. Devuelve la redirección. */
  async entrarConEnlace(correo: CorreoEnMemoria, direccion: string): Promise<Respuesta> {
    const antes = correo.enviados.length;
    const pedida = await this.pedir('/api/auth/sign-in/magic-link', {
      metodo: 'POST',
      cuerpo: { email: direccion, callbackURL: '/panel/cuenta' },
    });
    if (pedida.estado !== 200) return pedida;
    const mensaje = correo.enviados[antes];
    if (!mensaje) return { estado: 0, cuerpo: 'no llegó ningún correo', cabeceras: new Headers() };
    const enlace = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/.exec(mensaje.texto)?.[0];
    if (!enlace) return { estado: 0, cuerpo: 'el correo no trae enlace', cabeceras: new Headers() };
    const url = new URL(enlace);
    return this.pedir(`${url.pathname}${url.search}`);
  }
}
