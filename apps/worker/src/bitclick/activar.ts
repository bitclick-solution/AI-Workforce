/**
 * Guion de activación: pasa el puesto de Cobros de Bitclick de `en_prueba` a
 * `activo` (ADR-015, criterio de hecho 5 y 6).
 *
 *   pnpm --filter @aiw/worker bitclick:activar
 *
 * Ejecútalo después de validar el criterio de hecho 1 (comprobación de
 * registros compartidos): activar antes dejaría escribir contra registros que
 * todavía pueden verse desde otra empresa. Seguro de repetir: si el puesto ya
 * está activo, no toca nada y lo dice.
 */
import { crearConexion } from '@aiw/db';

import { activarPuestoDeCobros } from './activacion.js';
import { leerEstadoBitclick, MENSAJE_SIN_SIEMBRA } from './estado-local.js';
import { esProcesoPrincipal } from './proceso.js';

export async function principal(
  entorno: Record<string, string | undefined> = process.env,
): Promise<void> {
  const urlBaseDeDatos = entorno['DATABASE_URL'];
  if (urlBaseDeDatos === undefined || urlBaseDeDatos === '') {
    console.error('Falta DATABASE_URL. Levanta el entorno local y migra antes de activar.');
    process.exitCode = 1;
    return;
  }
  const estado = leerEstadoBitclick();
  if (!estado) {
    console.error(MENSAJE_SIN_SIEMBRA);
    process.exitCode = 1;
    return;
  }

  const conexion = crearConexion({ url: urlBaseDeDatos });
  try {
    const resultado = await activarPuestoDeCobros(conexion.cliente, estado);
    if (resultado.activado) {
      console.log('— Puesto de Cobros activado.');
      console.log('  Las escrituras aprobadas ya se ejecutan de verdad en Odoo, no se simulan.');
    } else {
      console.log(
        `— El puesto de Cobros ya estaba «${resultado.estadoPrevio}»: no se ha cambiado nada.`,
      );
    }
  } finally {
    await conexion.cerrar();
  }
}

if (esProcesoPrincipal(import.meta.url)) {
  await principal();
}
