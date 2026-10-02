/** Proxy de lectura del detalle de una tarea: pasos del libro y aprobación pendiente. */
import { configuracionInicioWeb, reenviarInicio } from '../../../../../lib/inicio';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(
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
  return reenviarInicio(
    `/inicio/tareas/${encodeURIComponent(id)}`,
    'GET',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
  );
}
