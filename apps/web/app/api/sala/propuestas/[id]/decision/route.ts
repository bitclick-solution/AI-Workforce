/** Proxy del clic sobre una propuesta de operación: aprobada o rechazada. */
import { cookiesDelAcceso } from '../../../../../../lib/acceso';
import { configuracionSala, llamarSala } from '../../../../../../lib/sala';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(
  peticion: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const configuracion = configuracionSala(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'La sala no está activa.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const { id } = await params;
  const leido = (await peticion.json().catch(() => ({}))) as { sentido?: unknown };
  const { estado, cuerpo } = await llamarSala(
    configuracion,
    'POST',
    `/sala/propuestas/${encodeURIComponent(id)}/decision`,
    fetch,
    cookiesDelAcceso(peticion.headers.get('cookie')),
    { sentido: leido.sentido },
  );
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: SIN_CACHE });
}
