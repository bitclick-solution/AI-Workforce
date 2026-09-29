'use client';

/**
 * Cliente de Better Auth en el navegador: enlace por correo y passkey.
 *
 * Habla con `/api/auth` del propio panel, que Next reenvía a la API. El navegador
 * no conoce la dirección de la API ni guarda nada fuera de la cookie `HttpOnly`.
 */
import { passkeyClient } from '@better-auth/passkey/client';
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';

const cliente = createAuthClient({
  basePath: '/api/auth',
  plugins: [magicLinkClient(), passkeyClient()],
});

/** Resultado de una acción del acceso: vacío si fue bien, con un aviso si no. */
export interface ResultadoDeAcceso {
  fallo?: string;
}

function resultado(error: { message?: string | undefined } | null | undefined): ResultadoDeAcceso {
  return error ? { fallo: error.message ?? 'error' } : {};
}

/** Pide el enlace por correo. La respuesta es la misma esté o no invitado el correo. */
export async function pedirEnlace(correo: string): Promise<ResultadoDeAcceso> {
  const { error } = await cliente.signIn.magicLink({
    email: correo,
    callbackURL: DESTINO_TRAS_ENTRAR,
    errorCallbackURL: '/acceso',
  });
  return resultado(error);
}

export async function entrarConPasskey(): Promise<ResultadoDeAcceso> {
  const respuesta = await cliente.signIn.passkey();
  return resultado(respuesta?.error);
}

export async function registrarPasskey(nombre: string): Promise<ResultadoDeAcceso> {
  const respuesta = await cliente.passkey.addPasskey({ name: nombre });
  return resultado(respuesta?.error);
}

export async function salir(): Promise<void> {
  await cliente.signOut();
}

/** Adónde va la persona al entrar: la cuenta, donde registra su passkey. */
export const DESTINO_TRAS_ENTRAR = '/panel/cuenta';

/** Mensajes de los errores que Better Auth pone en `?error=` al volver del enlace. */
export function mensajeDeError(codigo: string | undefined): string | undefined {
  if (!codigo) return undefined;
  if (codigo === 'INVALID_TOKEN' || codigo === 'EXPIRED_TOKEN') {
    return 'El enlace ya se usó o ha caducado. Pide otro.';
  }
  if (codigo === 'new_user_signup_disabled') {
    return 'Ese correo no tiene acceso. Si crees que debería, habla con Bitclick.';
  }
  return 'No se pudo entrar. Vuelve a intentarlo.';
}
