/**
 * Comando de Bitclick para invitar al propietario de una organización.
 *
 *   pnpm --filter @aiw/api invitar-propietario --organizacion "Asesoría Olmo" \
 *     --nombre "Marta Olmo" --correo marta@olmo.example
 *   pnpm --filter @aiw/api invitar-propietario --tenant <uuid> --nombre … --correo …
 *
 * Lee `DATABASE_URL`, `AIW_WEB_URL_PUBLICA` y las variables `AIW_CORREO_*` del
 * entorno. En local, con `AIW_CORREO_PROVEEDOR=smtp` y Mailpit, el aviso se ve en
 * `http://localhost:8025`; con `memoria`, el comando lo escribe en la salida. Nunca
 * imprime la cadena de conexión ni ninguna credencial.
 */
import { parseArgs } from 'node:util';

import { crearConexion } from '@aiw/db';

import { correoDesdeEntorno, urlPublicaDesdeEntorno } from './identidad/configuracion';
import { CorreoEnMemoria, crearCorreo } from './identidad/correo';
import { InvitacionNoValida, avisarInvitacion, invitarPropietario } from './identidad/invitar';

/** La salida del comando es para quien lo ejecuta: va a la salida estándar. */
function decir(texto: string): void {
  process.stdout.write(`[invitar-propietario] ${texto}\n`);
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((argumento) => argumento !== '--'),
  options: {
    organizacion: { type: 'string' },
    tenant: { type: 'string' },
    nombre: { type: 'string' },
    correo: { type: 'string' },
  },
});

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('[invitar-propietario] falta DATABASE_URL.');
  process.exit(1);
}

const conexion = crearConexion({ url, maxConexiones: 1 });
const invitacion = {
  organizacion: values.organizacion,
  tenantId: values.tenant,
  nombre: values.nombre ?? '',
  correo: values.correo ?? '',
};

try {
  const hecha = await invitarPropietario(conexion.cliente, invitacion);
  decir(`${hecha.organizacion}: tenant ${hecha.tenantId}, persona ${hecha.personaId}.`);
  const configuracionCorreo = correoDesdeEntorno(process.env);
  const urlPublica = urlPublicaDesdeEntorno(process.env);
  const correo = crearCorreo(configuracionCorreo);
  try {
    await avisarInvitacion(correo, configuracionCorreo.remitente, urlPublica, invitacion, hecha);
    if (correo instanceof CorreoEnMemoria) {
      decir(`correo en memoria:\n${correo.ultimo?.texto ?? ''}`);
    } else {
      decir('aviso enviado.');
    }
  } catch (error) {
    console.error(
      `[invitar-propietario] invitación creada, pero el aviso no salió (${error instanceof Error ? error.message : 'error'}). La persona puede pedir su enlace en ${urlPublica}/acceso.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  const motivo =
    error instanceof InvitacionNoValida
      ? error.message
      : `la invitación falló (${error instanceof Error ? error.message : 'error'}).`;
  console.error(`[invitar-propietario] ${motivo}`);
  process.exitCode = 1;
} finally {
  await conexion.cerrar();
}
