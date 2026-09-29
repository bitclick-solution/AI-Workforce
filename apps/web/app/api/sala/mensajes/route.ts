/**
 * Proxy de escritura en la sala: pasa el texto y, si llega, la sala (sala v1); la
 * persona la pone el servidor. Sin `salaId`, la sala general, igual que siempre.
 */
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
  const leido = (await peticion.json().catch(() => ({}))) as { texto?: unknown; salaId?: unknown };
  const { estado, cuerpo } = await llamarSala(configuracion, 'POST', '/sala/mensajes', fetch, {
    texto: typeof leido.texto === 'string' ? leido.texto : '',
    ...(typeof leido.salaId === 'string' ? { salaId: leido.salaId } : {}),
  });
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
