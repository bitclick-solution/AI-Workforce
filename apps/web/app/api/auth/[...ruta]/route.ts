/**
 * Reenvío de Better Auth: `/api/auth/*` del panel va a `/api/auth/*` de la API.
 *
 * El navegador no ve nunca la API. Aquí solo se copian método, cuerpo, las
 * cabeceras necesarias y las cookies del acceso, y vuelven estado, redirección y
 * cada `set-cookie`. Sin `AIW_ACCESO_PANEL` o sin `AIW_API_URL`, 404.
 */
import { accesoActivo, reenviarAcceso, urlDeLaApi } from '../../../../lib/acceso';

export const dynamic = 'force-dynamic';

async function reenviar(peticion: Request): Promise<Response> {
  const apiUrl = urlDeLaApi(process.env);
  if (!accesoActivo(process.env) || !apiUrl) {
    return Response.json(
      { error: 'El acceso al panel no está activo.' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  }
  return reenviarAcceso(peticion, apiUrl, fetch);
}

export const GET = reenviar;
export const POST = reenviar;
