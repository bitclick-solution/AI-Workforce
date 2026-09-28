/**
 * Acceso al panel desde el servidor de Next.
 *
 * El navegador solo habla con Next. Next reenvía `/api/auth/*` a la API, donde
 * vive Better Auth, y a cada llamada de datos (sala, contador) le pasa la cookie de
 * sesión del navegador. Solo esa: el resto de cookies del dominio no salen de aquí.
 * Quién es la persona y de qué organización lo decide la API al validar la sesión;
 * Next no manda ningún tenant.
 *
 * Detrás de `AIW_ACCESO_PANEL`. Apagada, `/api/auth` responde 404 y el panel no
 * pide sesión (la sala v1 con datos simulados sigue igual); los datos reales de
 * sala y contador no se ven, porque la API ya no acepta un tenant por cabecera.
 */

export const BANDERA_ACCESO = 'AIW_ACCESO_PANEL';

/** Prefijo de las cookies de Better Auth, con y sin el `__Secure-` de https. */
const COOKIE_DEL_ACCESO = /^(__Secure-)?aiw\./;

/** Cabeceras que viajan de la petición del navegador a la API en `/api/auth`. */
const CABECERAS_DE_IDA = ['content-type', 'origin', 'user-agent', 'accept', 'x-forwarded-for'];

/** Cabeceras que vuelven de la API al navegador, además de cada `set-cookie`. */
const CABECERAS_DE_VUELTA = ['content-type', 'location'];

export function accesoActivo(entorno: Record<string, string | undefined>): boolean {
  const valor = entorno[BANDERA_ACCESO]?.trim();
  return valor === '1' || valor === 'true';
}

/** URL interna de la API, sin barra final, o `undefined` si falta. */
export function urlDeLaApi(entorno: Record<string, string | undefined>): string | undefined {
  const url = entorno['AIW_API_URL']?.trim();
  return url ? url.replace(/\/+$/, '') : undefined;
}

/** De la cabecera `cookie` del navegador, solo las del acceso. */
export function cookiesDelAcceso(cabecera: string | null | undefined): string {
  if (!cabecera) return '';
  return cabecera
    .split(';')
    .map((par) => par.trim())
    .filter((par) => COOKIE_DEL_ACCESO.test(par.split('=')[0] ?? ''))
    .join('; ');
}

export type Buscador = (url: string, opciones: RequestInit) => Promise<Response>;

/**
 * Reenvía una petición de `/api/auth/*` a la API y devuelve su respuesta tal cual:
 * estado, redirección y cada `set-cookie`. No sigue redirecciones: la del enlace
 * por correo tiene que llegar al navegador con su cookie.
 */
export async function reenviarAcceso(
  peticion: Request,
  apiUrl: string,
  buscar: Buscador,
): Promise<Response> {
  const origen = new URL(peticion.url);
  const cabeceras = new Headers();
  for (const nombre of CABECERAS_DE_IDA) {
    const valor = peticion.headers.get(nombre);
    if (valor) cabeceras.set(nombre, valor);
  }
  const cookie = cookiesDelAcceso(peticion.headers.get('cookie'));
  if (cookie) cabeceras.set('cookie', cookie);

  const conCuerpo = peticion.method !== 'GET' && peticion.method !== 'HEAD';
  let respuesta: Response;
  try {
    respuesta = await buscar(`${apiUrl}${origen.pathname}${origen.search}`, {
      method: peticion.method,
      headers: cabeceras,
      redirect: 'manual',
      cache: 'no-store',
      ...(conCuerpo ? { body: await peticion.arrayBuffer() } : {}),
    });
  } catch {
    // El motivo real puede llevar la dirección interna de la API: no sale al navegador.
    return Response.json(
      { error: 'El acceso no responde. Vuelve a intentarlo.' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }

  const vuelta = new Headers({ 'cache-control': 'no-store' });
  for (const nombre of CABECERAS_DE_VUELTA) {
    const valor = respuesta.headers.get(nombre);
    if (valor) vuelta.set(nombre, valor);
  }
  for (const cookieNueva of respuesta.headers.getSetCookie())
    vuelta.append('set-cookie', cookieNueva);
  const cuerpo =
    respuesta.status === 204 || respuesta.status === 304 ? null : await respuesta.arrayBuffer();
  return new Response(cuerpo, { status: respuesta.status, headers: vuelta });
}

export interface SesionDelPanel {
  nombre: string;
  correo: string;
  caducaEn: string;
}

/** Pregunta a la API por la sesión de estas cookies. `null` si no hay una válida. */
export async function sesionDelPanel(
  apiUrl: string,
  cabeceraCookie: string | null | undefined,
  buscar: Buscador,
): Promise<SesionDelPanel | null> {
  const cookie = cookiesDelAcceso(cabeceraCookie);
  if (!cookie) return null;
  try {
    const respuesta = await buscar(`${apiUrl}/api/auth/get-session`, {
      headers: { cookie },
      cache: 'no-store',
    });
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as {
      user?: { name?: string; email?: string };
      session?: { expiresAt?: string };
    } | null;
    if (!cuerpo?.user?.email || !cuerpo.session?.expiresAt) return null;
    return {
      nombre: cuerpo.user.name ?? cuerpo.user.email,
      correo: cuerpo.user.email,
      caducaEn: cuerpo.session.expiresAt,
    };
  } catch {
    return null;
  }
}
