/**
 * Proxy del contador en el servidor de Next.
 *
 * Existe para que el token no llegue al navegador: el componente de cliente pide a
 * esta ruta, y es el servidor el que añade el token, reenvía la cookie de sesión y
 * llama a la API. La organización la decide la API a partir de la sesión.
 * Sin bandera o sin configuración completa, responde 404, igual que la vista.
 */
import { cookiesDelAcceso } from '../../../lib/acceso';
import { configuracionPanel, ErrorDelContador, leerContador } from '../../../lib/contador';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(peticion: Request): Promise<Response> {
  const configuracion = configuracionPanel(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El panel del contador no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }

  try {
    const datos = await leerContador(
      configuracion,
      (url, opciones) => fetch(url, { ...opciones, cache: 'no-store' }),
      cookiesDelAcceso(peticion.headers.get('cookie')),
    );
    return new Response(JSON.stringify(datos), { status: 200, headers: SIN_CACHE });
  } catch (error) {
    // El mensaje que se devuelve es el que ya viene saneado de `leerContador`.
    const motivo = error instanceof Error ? error.message : 'La lectura del contador falló.';
    // Sin sesión válida la API responde 401, y así le llega al navegador: no es una
    // API caída, es que hay que volver a entrar. El estado real viaja en el error,
    // no en su texto (`ErrorDelContador.estado`).
    const estado = error instanceof ErrorDelContador && error.estado === 401 ? 401 : 502;
    return new Response(JSON.stringify({ error: motivo }), { status: estado, headers: SIN_CACHE });
  }
}
