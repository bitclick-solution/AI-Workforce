/**
 * Proxy de escritura en la sala: solo pasa el texto y la cookie de sesión; la
 * persona la decide la API a partir de la sesión.
 */
import { cookiesDelAcceso } from '../../../../lib/acceso';
import { configuracionSala, llamarSala } from '../../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(peticion: Request): Promise<Response> {
  const configuracion = configuracionSala(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'La sala no está activa.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const leido = (await peticion.json().catch(() => ({}))) as { texto?: unknown };
  const { estado, cuerpo } = await llamarSala(
    configuracion,
    'POST',
    '/sala/mensajes',
    fetch,
    cookiesDelAcceso(peticion.headers.get('cookie')),
    { texto: typeof leido.texto === 'string' ? leido.texto : '' },
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
