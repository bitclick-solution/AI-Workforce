/** Proxy del perfil (ADR-026): solo reenvía la cookie de sesión, nunca un tenant. */
import { accesoActivo, urlDeLaApi } from '../../../lib/acceso';
import { reenviarPerfil } from '../../../lib/perfil';

export const dynamic = 'force-dynamic';

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function noDisponible(): Response {
  return new Response(JSON.stringify({ error: 'El perfil no está activo.' }), {
    status: 404,
    headers: SIN_CACHE,
  });
}

export async function GET(peticion: Request): Promise<Response> {
  const apiUrl = accesoActivo(process.env) ? urlDeLaApi(process.env) : undefined;
  if (!apiUrl) return noDisponible();
  return reenviarPerfil(peticion, apiUrl, fetch);
}

export async function PATCH(peticion: Request): Promise<Response> {
  const apiUrl = accesoActivo(process.env) ? urlDeLaApi(process.env) : undefined;
  if (!apiUrl) return noDisponible();
  return reenviarPerfil(peticion, apiUrl, fetch);
}
