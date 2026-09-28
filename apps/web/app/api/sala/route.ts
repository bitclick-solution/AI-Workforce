/**
 * Proxy de lectura de la sala. El token lo pone el servidor de Next y la cookie de
 * sesión la reenvía; tenant y persona los decide la API. Sin bandera o sin
 * configuración completa, 404.
 */
import { cookiesDelAcceso } from '../../../lib/acceso';
import { configuracionSala, llamarSala } from '../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(peticion: Request): Promise<Response> {
  const configuracion = configuracionSala(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'La sala no está activa.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const { estado, cuerpo } = await llamarSala(
    configuracion,
    'GET',
    '/sala',
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
    cookiesDelAcceso(peticion.headers.get('cookie')),
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
