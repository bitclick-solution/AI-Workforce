/**
 * Guion de siembra: crea (o confirma) la organización persistente de Bitclick.
 *
 *   pnpm --filter @aiw/worker bitclick:sembrar
 *
 * Seguro de repetir: si ya existe, no crea nada nuevo y lo dice.
 */
import { crearConexion } from '@aiw/db';

import { esProcesoPrincipal } from './proceso.js';
import { sembrarBitclick } from './siembra.js';

export async function principal(
  entorno: Record<string, string | undefined> = process.env,
): Promise<void> {
  const urlBaseDeDatos = entorno['DATABASE_URL'];
  if (urlBaseDeDatos === undefined || urlBaseDeDatos === '') {
    console.error('Falta DATABASE_URL. Levanta el entorno local y migra antes de sembrar.');
    process.exitCode = 1;
    return;
  }

  const conexion = crearConexion({ url: urlBaseDeDatos });
  try {
    const resultado = await sembrarBitclick(conexion.cliente, {
      ...(entorno['BITCLICK_CORREO_JESUS']
        ? { correoJesus: entorno['BITCLICK_CORREO_JESUS'] }
        : {}),
    });
    console.log(
      resultado.creada
        ? '— Organización Bitclick sembrada.'
        : '— La organización Bitclick ya existía: no se ha creado nada nuevo.',
    );
    console.log(`  tenant:        ${resultado.tenantId}`);
    console.log(`  departamento:  ${resultado.departamentoId}`);
    console.log(`  puesto Cobros: ${resultado.puestoId}`);
    console.log(`  conector Odoo: ${resultado.conectorId}`);
    console.log('');
    console.log('Guardado en .aiw-local/bitclick.json (no se sube al repositorio).');
  } finally {
    await conexion.cerrar();
  }
}

if (esProcesoPrincipal(import.meta.url)) {
  await principal();
}
