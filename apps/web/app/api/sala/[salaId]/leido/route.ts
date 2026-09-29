/** Proxy de «marcar como leída» una sala (sala v1). */
import { configuracionSala, llamarSala } from '../../../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(
  _peticion: Request,
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
    `/sala/${encodeURIComponent(salaId)}/leido`,
    fetch,
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
