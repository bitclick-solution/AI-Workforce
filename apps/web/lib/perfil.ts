/**
 * El ajuste de presencia del perfil desde el servidor de Next (ADR-026).
 *
 * Igual que el resto del panel: el navegador solo habla con Next, y es el
 * manejador de ruta el que reenvía la cookie de sesión a la API. `/perfil` no
 * lleva el token del panel que sí llevan sala y contador (decisión de la
 * especificación): ya exige una sesión válida, y ahí se resuelve la persona.
 */
import { cookiesDelAcceso } from './acceso';

export interface PerfilDelPanel {
  mostrarPresencia: boolean;
}

export type Buscador = (url: string, opciones: RequestInit) => Promise<Response>;

/** Lee el ajuste actual. `null` si no hay sesión o la API no responde. */
export async function perfilDelPanel(
  apiUrl: string,
  cabeceraCookie: string | null | undefined,
  buscar: Buscador,
): Promise<PerfilDelPanel | null> {
  const cookie = cookiesDelAcceso(cabeceraCookie);
  if (!cookie) return null;
  try {
    const respuesta = await buscar(`${apiUrl}/perfil`, { headers: { cookie }, cache: 'no-store' });
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as { mostrarPresencia?: unknown } | null;
    return typeof cuerpo?.mostrarPresencia === 'boolean'
      ? { mostrarPresencia: cuerpo.mostrarPresencia }
      : null;
  } catch {
    return null;
  }
}

/**
 * Reenvía una petición de `/api/perfil` a la API con la cookie de sesión del
 * navegador, y devuelve su respuesta tal cual.
 */
export async function reenviarPerfil(
  peticion: Request,
  apiUrl: string,
  buscar: Buscador,
): Promise<Response> {
  const cookie = cookiesDelAcceso(peticion.headers.get('cookie'));
  const conCuerpo = peticion.method !== 'GET' && peticion.method !== 'HEAD';
  let respuesta: Response;
  try {
    respuesta = await buscar(`${apiUrl}/perfil`, {
      method: peticion.method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(conCuerpo ? { 'content-type': 'application/json' } : {}),
      },
      cache: 'no-store',
      ...(conCuerpo ? { body: await peticion.text() } : {}),
    });
  } catch {
    // El motivo real puede llevar la dirección interna de la API: no sale al navegador.
    return Response.json(
      { error: 'El perfil no responde. Vuelve a intentarlo.' },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }
  const cuerpo = respuesta.status === 204 ? null : await respuesta.arrayBuffer();
  return new Response(cuerpo, {
    status: respuesta.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
