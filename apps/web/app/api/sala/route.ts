/**
 * Proxy de lectura de la sala. El token, el tenant y la persona los pone el
 * servidor de Next; sin bandera o sin configuración completa, 404.
 *
 * Con `?salaId=`, lee esa sala (sala v1); sin él, la sala general, igual que
 * siempre.
 */
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
  const salaId = new URL(peticion.url).searchParams.get('salaId');
  const ruta = salaId ? `/sala?salaId=${encodeURIComponent(salaId)}` : '/sala';
  const { estado, cuerpo } = await llamarSala(configuracion, 'GET', ruta, (url, opciones) =>
    fetch(url, { ...opciones, cache: 'no-store' }),
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
