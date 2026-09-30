/** Proxy de lectura de los avisos del inicio: aprobaciones pendientes de la persona de la sesión. */
import { configuracionInicioWeb, reenviarInicio } from '../../../../lib/inicio';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(peticion: Request): Promise<Response> {
  const configuracion = configuracionInicioWeb(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El inicio no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  return reenviarInicio(
    '/inicio/avisos',
    'GET',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
  );
}
