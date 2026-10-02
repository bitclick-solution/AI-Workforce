/** Proxy de lectura del expediente de un agente: niveles, lecciones y acciones rechazadas. */
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
    `/puestos/${encodeURIComponent(id)}/expediente`,
    'GET',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
  );
}
