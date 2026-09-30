/**
 * Proxy de «encargar»: el widget de saludo manda el encargo y el puesto destino, y
 * es la API la que crea la tarea raíz y arranca el flujo, con la persona de la
 * sesión y no de este cuerpo.
 */
import { configuracionInicioWeb, reenviarInicio } from '../../../../lib/inicio';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function POST(peticion: Request): Promise<Response> {
  const configuracion = configuracionInicioWeb(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El inicio no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }
  const leido = (await peticion.json().catch(() => ({}))) as {
    puestoId?: unknown;
    encargo?: unknown;
  };
  return reenviarInicio(
    '/inicio/encargar',
    'POST',
    configuracion.apiUrl,
    peticion.headers.get('cookie'),
    fetch,
    {
      puestoId: typeof leido.puestoId === 'string' ? leido.puestoId : '',
      encargo: typeof leido.encargo === 'string' ? leido.encargo : '',
    },
  );
}
