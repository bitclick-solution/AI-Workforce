/**
 * Demostración de la prueba técnica del stack, de punta a punta.
 *
 *   pnpm --filter @aiw/worker demo:cobros            # espera que decidas tú
 *   pnpm --filter @aiw/worker demo:cobros --auto     # aprueba sola, para grabar
 *
 * Qué enseña, en orden: siembra Finanzas con dos puestos, arranca un trabajador,
 * lanza la tarea, el agente lista tres facturas vencidas, pide una aprobación por
 * nota y espera, tú decides con `pnpm --filter @aiw/worker decidir`, ejecuta las
 * notas aprobadas, delega la conciliación de la primera factura al puesto en prueba
 * como flujo hijo con contrato, recoge su resultado y cierra la tarea imprimiendo su
 * coste, su cadena de auditoría verificada y el contador.
 *
 * Necesita el Compose de desarrollo levantado (`pnpm dev:up`): PostgreSQL migrado y
 * Temporal escuchando. El conector de demostración se monta en memoria dentro de
 * este proceso, así que no hace falta Odoo ni ningún servicio más.
 */
import { conTenant } from '@aiw/db';
import { NativeConnection } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import { verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';

import { BANDERA, aprendizajeEncendido, leerConfiguracion } from './configuracion.js';
import { enrutadorDeLaDemo } from './actividades/contexto.js';
import { montarTrabajador } from './trabajador.js';
import { crearTareaRaiz, sembrarDemostracion } from './semilla.js';
import { tareaAgente } from './flujos/index.js';
import { PUESTO_CONCILIACION } from '@aiw/db/pruebas';

const AUTOMATICA = process.argv.includes('--auto');

const configuracion = leerConfiguracion();
if (!configuracion.encendida) {
  console.error(`La demostración está detrás de una bandera: pon ${BANDERA}=1.`);
  process.exit(1);
}
if (configuracion.urlBaseDeDatos === undefined) {
  console.error('Falta DATABASE_URL. Levanta el Compose con `pnpm dev:up` y migra con');
  console.error('`pnpm --filter @aiw/db db:migrar`.');
  process.exit(1);
}
if (!configuracion.conectorDemoConfigurado) {
  console.error('Falta DEMO_CONECTOR_SECRETO. `pnpm dev:up` lo añade a .env, también a uno que ya');
  console.error('existía; después vuelve a cargar .env en esta terminal, como dice el runbook.');
  process.exit(1);
}

const marca = Date.now();
const cola = `${configuracion.temporal.cola}-${marca}`;

const conexionTemporal = await NativeConnection.connect({
  address: configuracion.temporal.direccion,
});
const montado = await montarTrabajador({
  // Demostración determinista: `prueba` salvo que AIW_PROVEEDOR_MODELOS diga otra cosa.
  enrutador: enrutadorDeLaDemo(),
  urlBaseDeDatos: configuracion.urlBaseDeDatos,
  cola,
  espacio: configuracion.temporal.espacio,
  conexion: conexionTemporal,
});

const clienteTemporal = new Client({
  connection: await Connection.connect({ address: configuracion.temporal.direccion }),
  namespace: configuracion.temporal.espacio,
});

/**
 * Imprime lo que entrega el hijo. Conciliación entrega un informe en JSON, que es el
 * formato del contrato; se enseña legible, con el asiento propuesto línea a línea.
 * Si lo entregado no es ese informe —un respaldo por plazo vencido, por ejemplo—,
 * se imprime tal cual.
 */
function imprimirEntrega(texto: string): void {
  let informe: {
    resumen?: unknown;
    propuestas?: {
      factura?: unknown;
      asiento_propuesto?: {
        cuenta?: unknown;
        concepto?: unknown;
        debe?: unknown;
        haber?: unknown;
      }[];
      movimiento_bancario?: unknown;
    }[];
  };
  try {
    informe = JSON.parse(texto) as typeof informe;
  } catch {
    console.log(`    resumen:            ${texto}`);
    return;
  }
  console.log(`    resumen:            ${String(informe.resumen ?? '')}`);
  for (const propuesta of informe.propuestas ?? []) {
    console.log(`    asiento ${String(propuesta.factura)}:`);
    for (const linea of propuesta.asiento_propuesto ?? []) {
      const importe =
        Number(linea.debe) > 0
          ? `debe  ${Number(linea.debe).toFixed(2)}`
          : `haber ${Number(linea.haber).toFixed(2)}`;
      console.log(
        `      ${String(linea.cuenta)} ${String(linea.concepto).padEnd(10)} ${importe} €`,
      );
    }
    console.log(
      `      movimiento bancario: ${propuesta.movimiento_bancario === null ? 'pendiente, sin extracto' : String(propuesta.movimiento_bancario)}`,
    );
  }
}

/** Aprobaciones que ya se han mostrado, para no repetirlas en cada vuelta. */
const mostradas = new Set<string>();

async function pendientes(
  cliente: postgres.Sql,
  tenantId: string,
  tareaId: string,
): Promise<{ id: string; clase: string; resumen: string }[]> {
  return conTenant(cliente, tenantId, async (tx) => {
    const filas = await tx<{ id: string; clase_accion: string; resumen_legible: string }[]>`
      select a.id, a.clase_accion, a.resumen_legible
      from aprobacion a
      where a.tenant_id = ${tenantId} and a.tarea_id = ${tareaId}
        and not exists (
          select 1 from decision_aprobacion d
          where d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
        )
      order by a.creado_en asc
    `;
    return filas.map((fila) => ({
      id: fila.id,
      clase: fila.clase_accion,
      resumen: fila.resumen_legible,
    }));
  });
}

console.log('— Sembrando Finanzas con los puestos Cobros (activo) y Conciliación (en prueba).');
const cliente = montado.cliente;

const semilla = await sembrarDemostracion(cliente, {
  nombre: `Demostración de cobros ${marca}`,
});
const { tareaId } = await crearTareaRaiz(cliente, {
  tenantId: semilla.tenantId,
  puestoId: semilla.cobros.puestoId,
  versionPuestoId: semilla.cobros.versionPuestoId,
  presupuestoEuros: 1,
});

console.log(`  tenant:   ${semilla.tenantId}`);
console.log(`  tarea:    ${tareaId}`);
console.log(`  cola:     ${cola}`);
console.log('');

const mango = await clienteTemporal.workflow.start(tareaAgente, {
  taskQueue: cola,
  workflowId: `demo-cobros-${tareaId}`,
  args: [
    {
      tenantId: semilla.tenantId,
      puestoId: semilla.cobros.puestoId,
      versionPuestoId: semilla.cobros.versionPuestoId,
      tareaId,
      encargo:
        'Haz el seguimiento de cobros de hoy: revisa las facturas vencidas y deja una ' +
        'nota de seguimiento en cada una.',
      validezAprobacionSegundos: 600,
      // Con AIW_APRENDIZAJE_V0=1, `decidir <id> editada --texto "…"` lanza el flujo
      // de aprendizaje y deja una lección propuesta para promocionar a mano.
      aprendizaje: aprendizajeEncendido(),
      delegacion: {
        puestoDestinoNombre: PUESTO_CONCILIACION,
        contrato: {
          encargo: 'Concilia la factura F-2026-0001 con el extracto bancario.',
          plazoSegundos: 120,
          presupuestoEuros: 0.2,
          formato: { formato: 'json', criteriosAceptacion: ['Indica el asiento propuesto'] },
          caducidadSegundos: 600,
          politicaRespaldo: 'seguir_sin_ello',
        },
      },
    },
  ],
});

console.log(`— Flujo ${mango.workflowId} arrancado. Esperando al agente.`);
console.log('');

const resultado = await montado.trabajador.runUntil(async () => {
  const fin = mango.result();
  let terminado = false;
  void fin.finally(() => {
    terminado = true;
  });

  while (!terminado) {
    for (const aprobacion of await pendientes(cliente, semilla.tenantId, tareaId)) {
      if (mostradas.has(aprobacion.id)) continue;
      mostradas.add(aprobacion.id);
      console.log(`— Aprobación pendiente (${aprobacion.clase}): ${aprobacion.id}`);
      console.log(`  ${aprobacion.resumen}`);
      if (AUTOMATICA) {
        const { registrarDecision, cargaDeSenal, leerAprobacion } = await import('@aiw/ledger');
        const decidida = await registrarDecision(cliente, semilla.tenantId, {
          aprobacionId: aprobacion.id,
          sentido: 'aprobada',
          origen: 'plataforma',
          herramienta: 'demo:cobros --auto',
        });
        if (decidida.estado === 'registrada') {
          const leida = await conTenant(cliente, semilla.tenantId, (tx) =>
            leerAprobacion(tx, semilla.tenantId, aprobacion.id),
          );
          if (leida) {
            await mango.signal(
              'decisionDeAprobacion',
              cargaDeSenal(semilla.tenantId, leida, decidida.decision, 'plataforma'),
            );
          }
          console.log('  aprobada automáticamente (--auto).');
        }
      } else {
        console.log(
          `  decide con: pnpm --filter @aiw/worker decidir ${aprobacion.id} aprobada ` +
            `--tenant ${semilla.tenantId}`,
        );
      }
      console.log('');
    }
    await new Promise((listo) => setTimeout(listo, 500));
  }
  return fin;
});

console.log('— Tarea terminada.');
console.log(`  estado:               ${resultado.estado}`);
console.log(`  resumen:              ${resultado.resumen}`);
console.log(`  pasos de modelo:      ${resultado.pasos}`);
console.log(`  aprobaciones pedidas: ${resultado.aprobacionesPedidas}`);
console.log(`  escrituras hechas:    ${resultado.escriturasEjecutadas}`);
console.log(`  escrituras saltadas:  ${resultado.escriturasSaltadas}`);
console.log(`  escrituras simuladas: ${resultado.escriturasSimuladas}`);
console.log(`  coste:                ${resultado.costeEuros.toFixed(4)} €`);
if (resultado.delegacion) {
  console.log(`  delegación:           ${resultado.delegacion.tareaDestinoId}`);
  console.log(`    entregada:          ${resultado.delegacion.entregado ? 'sí' : 'no'}`);
  imprimirEntrega(resultado.delegacion.resumen);
  if (resultado.delegacion.respaldoAplicado) {
    console.log(`    respaldo aplicado:  ${resultado.delegacion.respaldoAplicado}`);
  }
}
console.log('');

const verificacion = await conTenant(cliente, semilla.tenantId, (tx) =>
  verificarCadenaEnBase(tx, semilla.tenantId),
);
const [contador] = await conTenant(cliente, semilla.tenantId, async (tx) => {
  const filas = await tx<
    { tareas: string; pasos: string; acciones: string; coste_euros: string }[]
  >`
    select tareas, pasos, acciones, coste_euros from contador_consumo
    where tenant_id = ${semilla.tenantId}
  `;
  return [...filas];
});

console.log('— Libro de auditoría y contador.');
console.log(
  `  cadena verificada:    ${verificacion.valida ? 'sí' : `no (${verificacion.motivo})`}`,
);
console.log(`  entradas:             ${verificacion.entradas}`);
console.log(`  tareas contadas:      ${contador?.tareas ?? 0}`);
console.log(`  acciones:             ${contador?.acciones ?? 0}`);
console.log(`  coste del contador:   ${Number(contador?.coste_euros ?? 0).toFixed(4)} €`);

// `runUntil` ya paró el trabajador al resolverse: pararlo otra vez lanza
// `IllegalStateError`. Se vio al ejecutar la demostración de punta a punta.
await montado.cerrar();
await conexionTemporal.close();
await clienteTemporal.connection.close();
process.exit(0);
