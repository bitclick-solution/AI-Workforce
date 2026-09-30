/** Proxy de lectura de los agentes del inicio: estado, tarea en curso y últimas completadas. */
import { configuracionInicioWeb, reenviarInicio } from '../../../../lib/inicio';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(peticion: Request): Promise<Response> {
  const configuracion = configuracionInicioWeb(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El inicio no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  return reenviarInicio(
    '/inicio/agentes',
    'GET',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
  );
}
