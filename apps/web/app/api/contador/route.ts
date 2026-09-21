/**
 * Proxy del contador en el servidor de Next.
 *
 * Existe para que el token no llegue al navegador: el componente de cliente pide a
 * esta ruta, y es el servidor el que añade el token y el tenant y llama a la API.
 * Sin bandera o sin configuración completa, responde 404, igual que la vista.
 */
import { configuracionPanel, leerContador } from '../../../lib/contador';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export async function GET(): Promise<Response> {
  const configuracion = configuracionPanel(process.env);
  if (!configuracion) {
    return new Response(JSON.stringify({ error: 'El panel del contador no está activo.' }), {
      status: 404,
      headers: SIN_CACHE,
    });
  }

  try {
    const datos = await leerContador(configuracion, (url, opciones) =>
      fetch(url, { ...opciones, cache: 'no-store' }),
    );
    return new Response(JSON.stringify(datos), { status: 200, headers: SIN_CACHE });
  } catch (error) {
    // El mensaje que se devuelve es el que ya viene saneado de `leerContador`.
    const motivo = error instanceof Error ? error.message : 'La lectura del contador falló.';
    return new Response(JSON.stringify({ error: motivo }), { status: 502, headers: SIN_CACHE });
  }
}
