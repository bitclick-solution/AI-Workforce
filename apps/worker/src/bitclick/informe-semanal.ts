/**
 * Informe semanal de Bitclick (ADR-024, criterio de hecho 7).
 *
 *   pnpm --filter @aiw/worker bitclick:informe
 *
 * Tareas, aprobadas sin cambios y coste, a partir de las consultas de lectura
 * del contador ya construidas (`tareasDelPeriodo`, `costePorPuesto` de
 * `@aiw/ledger`) más una única lectura de `decision_aprobacion` para contar las
 * aprobadas sin editar: ninguna tabla nueva. El periodo es el mes en curso,
 * igual que el resto del panel del contador; con una semana de uso cabe dentro.
 */
import { conTenant, crearConexion } from '@aiw/db';
import { costePorPuesto, tareasDelPeriodo } from '@aiw/ledger';
import type postgres from 'postgres';

import { leerEstadoBitclick, MENSAJE_SIN_SIEMBRA } from './estado-local.js';
import { esProcesoPrincipal } from './proceso.js';

/** Decisiones «aprobada» (sin editar) de las tareas del puesto en el periodo en curso. */
export async function aprobadasSinCambios(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<number> {
  const filas = await tx<{ total: string }[]>`
    select count(*)::text as total
    from decision_aprobacion d
    join aprobacion a on a.tenant_id = d.tenant_id and a.id = d.aprobacion_id
    join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
    where d.tenant_id = ${tenantId} and t.puesto_id = ${puestoId}
      and d.sentido = 'aprobada'
      and coalesce(t.tarea_raiz_id, t.id) = t.id
      and t.creado_en >= date_trunc('month', now())
  `;
  return Number(filas[0]?.total ?? 0);
}

export async function principal(
  entorno: Record<string, string | undefined> = process.env,
): Promise<void> {
  const urlBaseDeDatos = entorno['DATABASE_URL'];
  if (urlBaseDeDatos === undefined || urlBaseDeDatos === '') {
    console.error('Falta DATABASE_URL. Levanta el entorno local y migra antes del informe.');
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
    const { tareas, aprobadas, porPuesto } = await conTenant(
      conexion.cliente,
      estado.tenantId,
      async (tx) => ({
        tareas: await tareasDelPeriodo(tx, estado.tenantId),
        aprobadas: await aprobadasSinCambios(tx, estado.tenantId, estado.puestoId),
        porPuesto: await costePorPuesto(tx, estado.tenantId),
      }),
    );

    const costeTotalEuros = porPuesto.reduce((suma, fila) => suma + fila.costeModelosEuros, 0);

    console.log(
      `Informe semanal de Bitclick · Cobros (periodo: ${tareas.tareas[0]?.creadoEn.slice(0, 7) ?? 'sin tareas todavía'})`,
    );
    console.log('');
    console.log(`  tareas de Cobros:        ${String(tareas.total)}`);
    console.log(`  aprobadas sin cambios:   ${String(aprobadas)}`);
    console.log(`  coste total del periodo: ${costeTotalEuros.toFixed(4)} €`);
    console.log('');
    console.log('  reparto por estado:');
    for (const [estadoTarea, total] of Object.entries(tareas.porEstado)) {
      console.log(`    ${estadoTarea}: ${String(total)}`);
    }
  } finally {
    await conexion.cerrar();
  }
}

if (esProcesoPrincipal(import.meta.url)) {
  await principal();
}
