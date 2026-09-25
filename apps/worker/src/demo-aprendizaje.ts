/**
 * Demostración del aprendizaje v0, de punta a punta, con un solo mandato.
 *
 *   AIW_APRENDIZAJE_V0=1 pnpm --filter @aiw/worker demo:aprendizaje           # esperas a que promociones tú
 *   AIW_APRENDIZAJE_V0=1 pnpm --filter @aiw/worker demo:aprendizaje --auto    # promociona sola, para grabar
 *
 * Qué enseña, en orden: siembra Finanzas; el agente de Cobros pide aprobar una nota;
 * Jesús la edita antes de aprobarla; el flujo de aprendizaje registra la señal y
 * propone una lección de memoria sin datos personales; Jesús la promociona a mano
 * (con el mandato `aprendizaje promocionar`, que la demo imprime y espera) y la
 * puerta del Evaluador la certifica; la tarea siguiente arranca con la versión nueva
 * y la lección está en su prompt; se revierte y la tarea siguiente vuelve a la
 * anterior; termina con la cadena de auditoría verificada y el contador.
 *
 * Solo necesita PostgreSQL migrado (`pnpm dev:up`). Las dos actividades del flujo
 * `aprendizajeDeSenal` se llaman aquí directamente, en el mismo orden que el flujo:
 * así la demo no depende de un servidor de Temporal. El flujo durable, con su
 * arranque desde la tarea, se prueba contra Temporal en `pruebas/aprendizaje.test.ts`
 * y se ve en `demo:cobros` con `decidir <id> editada --texto "…"`.
 */
import { aplicarMigraciones, conTenant, crearConexion } from '@aiw/db';
import { HERRAMIENTA_NOTA } from '@aiw/connector-demo';
import { aprendizaje as evalsAprendizaje } from '@aiw/evals';
import { promocionarLeccion, revertirVersion } from '@aiw/learning';
import { registrarDecision, solicitarAprobacion, verificarCadenaEnBase } from '@aiw/ledger';

import { BANDERA_APRENDIZAJE, aprendizajeEncendido, leerConfiguracion } from './configuracion.js';
import { montarParaPruebas } from './pruebas/montaje.js';
import { crearTareaConVersionActiva } from './semilla.js';

const AUTOMATICA = process.argv.includes('--auto');
/** Cuánto espera la demo a que promociones a mano. */
const ESPERA_MS = 15 * 60_000;

if (!aprendizajeEncendido()) {
  console.error(`La demostración está detrás de una bandera: pon ${BANDERA_APRENDIZAJE}=1.`);
  process.exit(1);
}
if (leerConfiguracion().urlBaseDeDatos === undefined) {
  console.error('Falta DATABASE_URL. Levanta el Compose con `pnpm dev:up`.');
  process.exit(1);
}

function titulo(texto: string): void {
  console.log(`\n── ${texto}`);
}

// Migrar es idempotente: así la demo es un solo mandato sobre una base recién levantada.
const migracion = crearConexion({ url: leerConfiguracion().urlBaseDeDatos as string });
try {
  await aplicarMigraciones(migracion.cliente);
} finally {
  await migracion.cerrar();
}

const montaje = await montarParaPruebas({ nombre: `Demostración de aprendizaje ${Date.now()}` });
const { cliente, actividades, semilla } = montaje;
const { tenantId, personaId } = semilla;
const puestoId = semilla.cobros.puestoId;

try {
  titulo('1. Finanzas sembrada');
  console.log(`  tenant:  ${tenantId}`);
  console.log(`  puesto:  Cobros (${puestoId}), versión 1 activa`);
  console.log(`  persona: Jesús (${personaId})`);

  titulo('2. El agente pide aprobar una nota y Jesús la edita antes de aprobarla');
  const antes = {
    conector: 'demo',
    argumentos: {
      factura_id: 'inv-0001',
      texto: 'Le recordamos que su factura F-2026-0001 se encuentra vencida.',
    },
  };
  const despues = {
    ...antes,
    argumentos: {
      ...antes.argumentos,
      texto:
        'Te escribo para recordarte que tu factura F-2026-0001 sigue pendiente. Si ya la ' +
        'pagaste, contéstame a marta.garcia@cliente-demo.es y lo reviso.',
    },
  };
  const aprobacion = await conTenant(cliente, tenantId, (tx) =>
    solicitarAprobacion(tx, tenantId, {
      tareaId: montaje.tareaId,
      personaId,
      claseAccion: 'escritura',
      nivelExigido: 'n1',
      borradorOpaco: { tipo: `herramienta.${HERRAMIENTA_NOTA}`, carga: antes },
      resumenLegible: 'Nota de seguimiento de F-2026-0001',
      venceEn: new Date(Date.now() + 3_600_000),
    }),
  );
  await registrarDecision(cliente, tenantId, {
    aprobacionId: aprobacion.id,
    sentido: 'editada',
    edicionPrevia: { antes, despues },
    origen: 'panel',
  });
  console.log(`  antes:   ${antes.argumentos.texto}`);
  console.log(`  después: ${despues.argumentos.texto}`);

  titulo('3. El flujo de aprendizaje registra la señal y propone la lección');
  const senal = await actividades.registrarSenalDeEdicion({
    tenantId,
    aprobacionId: aprobacion.id,
  });
  const leccion = await actividades.proponerLeccionDeSenal({
    tenantId,
    senalId: senal.senalId,
    senalCreadoEn: senal.senalCreadoEn,
  });
  console.log(`  señal:   ${senal.senalId}`);
  console.log(`  lección: ${leccion.leccionId} (propuesta)`);
  console.log(`  «${leccion.linea}»`);

  titulo('4. Jesús la promociona a mano');
  const mandato =
    `AIW_APRENDIZAJE_V0=1 DATABASE_URL=… pnpm --filter @aiw/worker aprendizaje promocionar ` +
    `${leccion.leccionId} --persona ${personaId} --tenant ${tenantId}`;
  let versionNueva: string;
  if (AUTOMATICA) {
    const promocion = await promocionarLeccion(cliente, tenantId, {
      leccionId: leccion.leccionId,
      personaId,
      puerta: evalsAprendizaje.certificarPromocion,
      motivo: 'Tuteamos a los clientes',
    });
    for (const caso of promocion.resultados.casos) console.log(`  ok  ${caso.diagnostico}`);
    if (promocion.estado !== 'promocionada') throw new Error('El Evaluador bloqueó la promoción.');
    versionNueva = promocion.versionPuestoId;
  } else {
    console.log('  Ejecuta en otra terminal:');
    console.log(`  ${mandato}`);
    console.log('  La demo espera a que la promoción aparezca…');
    const hasta = Date.now() + ESPERA_MS;
    let encontrada: string | undefined;
    while (!encontrada && Date.now() < hasta) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ version: string }[]>`
          select version_puesto_resultante_id as version from promocion
          where tenant_id = ${tenantId} and leccion_id = ${leccion.leccionId}
        `,
      );
      encontrada = fila?.version;
      if (!encontrada) await new Promise((listo) => setTimeout(listo, 1000));
    }
    if (!encontrada) throw new Error('Nadie promocionó la lección en quince minutos.');
    versionNueva = encontrada;
  }

  titulo('5. La tarea siguiente usa la versión nueva y ve la lección');
  const siguiente = await crearTareaConVersionActiva(cliente, {
    tenantId,
    puestoId,
    presupuestoEuros: 1,
  });
  if (siguiente.versionPuestoId !== versionNueva)
    throw new Error('La tarea no tomó la versión nueva.');
  const contexto = await actividades.leerContexto({
    tenantId,
    puestoId,
    versionPuestoId: siguiente.versionPuestoId,
    tareaId: siguiente.tareaId,
  });
  console.log(`  tarea ${siguiente.tareaId} con la versión ${siguiente.numeroVersion}`);
  console.log(
    contexto.sistema
      .split('\n')
      .map((linea) => `  │ ${linea}`)
      .join('\n'),
  );

  titulo('6. Reversión: la tarea siguiente vuelve a la versión 1');
  const revertida = await revertirVersion(cliente, tenantId, {
    puestoId,
    aVersionId: semilla.cobros.versionPuestoId,
    personaId,
    motivo: 'Demostración de la reversión',
  });
  const trasRevertir = await crearTareaConVersionActiva(cliente, {
    tenantId,
    puestoId,
    presupuestoEuros: 1,
  });
  const contextoRevertido = await actividades.leerContexto({
    tenantId,
    puestoId,
    versionPuestoId: trasRevertir.versionPuestoId,
    tareaId: trasRevertir.tareaId,
  });
  console.log(`  lecciones retiradas: ${revertida.retiradas.join(', ')}`);
  console.log(`  tarea ${trasRevertir.tareaId} con la versión ${trasRevertir.numeroVersion}`);
  console.log(
    `  la lección ${contextoRevertido.sistema.includes(leccion.linea) ? 'SIGUE' : 'ya no está'} en el prompt`,
  );

  titulo('7. Libro de auditoría y contador');
  const { valida, acciones } = await conTenant(cliente, tenantId, async (tx) => {
    const verificacion = await verificarCadenaEnBase(tx, tenantId);
    const filas = await tx<{ accion: string }[]>`
      select accion from entrada_auditoria
      where tenant_id = ${tenantId}
        and (accion like 'aprendizaje.%' or accion = 'aprobacion.editada')
      order by numero_orden
    `;
    return { valida: verificacion.valida, acciones: filas.map((f) => f.accion) };
  });
  for (const accion of acciones) console.log(`  ${accion}`);
  const [contador] = await conTenant(
    cliente,
    tenantId,
    (tx) => tx<{ acciones: string }[]>`
      select sum(acciones)::text as acciones from contador_consumo where tenant_id = ${tenantId}
    `,
  );
  console.log(`  cadena verificada: ${valida ? 'sí' : 'NO'}`);
  console.log(`  acciones en el contador: ${contador?.acciones ?? 0}`);
  if (!valida) process.exitCode = 1;
} finally {
  await montaje.cerrar();
}
