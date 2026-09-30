/** Proxy de la decisión en línea de un aviso: aprobar o rechazar sin salir del inicio. */
import { configuracionInicioWeb, reenviarInicio } from '../../../../../../lib/inicio';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(
  peticion: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const configuracion = configuracionInicioWeb(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El inicio no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const { id } = await params;
  const leido = (await peticion.json().catch(() => ({}))) as { sentido?: unknown };
  return reenviarInicio(
    `/inicio/avisos/${encodeURIComponent(id)}/decidir`,
    'POST',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    fetch,
    { sentido: leido.sentido },
  );
}
