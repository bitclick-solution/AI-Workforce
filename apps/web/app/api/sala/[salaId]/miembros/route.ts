/** Proxy de lectura de los miembros de una sala, con su estado (sala v1). */
import { cookiesDelAcceso } from '../../../../../lib/acceso';
import { configuracionSala, llamarSala } from '../../../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(
  peticion: Request,
  { params }: { params: Promise<{ salaId: string }> },
): Promise<Response> {
  const configuracion = configuracionSala(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'La sala no está activa.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const { salaId } = await params;
  const { estado, cuerpo } = await llamarSala(
    configuracion,
    'GET',
    `/sala/${encodeURIComponent(salaId)}/miembros`,
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
    cookiesDelAcceso(peticion.headers.get('cookie')),
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
