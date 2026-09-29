/**
 * Proxy del token de conexión y de canal de Centrifugo (sala v1). Añade la URL
 * pública del WebSocket, que no es un secreto pero solo el servidor la conoce: el
 * navegador no lee variables de entorno.
 */
import { cookiesDelAcceso } from '../../../../../lib/acceso';
import { configuracionSala, llamarSala, urlWebSocketCentrifugo } from '../../../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(
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
    'POST',
    `/sala/${encodeURIComponent(salaId)}/token`,
    fetch,
    cookiesDelAcceso(peticion.headers.get('cookie')),
  );
  const wsUrl = urlWebSocketCentrifugo(process.env);
  const conWsUrl =
    estado === 200 && typeof cuerpo === 'object' && cuerpo !== null && wsUrl
      ? { ...cuerpo, wsUrl }
      : cuerpo;
  return new Response(JSON.stringify(conWsUrl), { status: estado, headers: SIN_CACHE });
}
