/**
 * Lanzamiento repetible de una tarea de Cobros contra el Odoo real de Bitclick
 * (ADR-024, criterios de hecho 3, 4, 5 y 6).
 *
 *   pnpm --filter @aiw/worker bitclick:cobros
 *
 * Cada ejecución crea una tarea raíz nueva sobre el puesto ya sembrado
 * (`bitclick:sembrar`): es repetible a propósito, para poder lanzarla cada día
 * de la semana de uso. No aprueba nada por sí solo —a diferencia de
 * `demo-cobros.ts --auto`—: el recordatorio que el agente proponga espera la
 * decisión real de Jesús por correo, con `AIW_APROBACION_CORREO=1`.
 *
 * Cada tarea paga con el modelo que diga el `enrutado_modelo` de la plantilla
 * certificada `finanzas.reclamacion-de-cobros` (`./siembra.ts`): hoy el proveedor
 * de prueba determinista, porque el bucle del agente todavía no tiene un
 * proveedor real de Bedrock o Vertex registrado en su enrutador (paquete
 * `@aiw/models`, ruta «Modelos v1» — sección aparte del runbook). El conector de
 * Odoo sí es el real: la parte que importa para los criterios de hecho de esta
 * rebanada corre contra la empresa de pruebas de verdad.
 */
import { conTenant } from '@aiw/db';
import { verificarCadenaEnBase } from '@aiw/ledger';
import { NativeConnection } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import type postgres from 'postgres';

import { enrutadorDeDemostracion, registroDeOdooPorProceso } from '../actividades/contexto.js';
import { crearTareaRaiz } from '../semilla.js';
import { tareaAgente } from '../flujos/index.js';
import { montarTrabajador } from '../trabajador.js';

import { NOMBRE_CONECTOR_ODOO } from './constantes.js';
import { leerEstadoBitclick, MENSAJE_SIN_SIEMBRA } from './estado-local.js';
import { esProcesoPrincipal } from './proceso.js';
import { plantillaCobros } from './siembra.js';

const ENCARGO_COBROS =
  'Revisa las facturas vencidas de la empresa de pruebas y deja una nota de seguimiento en ' +
  'cada una que corresponda, en el tono de la organización.';

/** Tres días: tiempo real para que Jesús lea el correo, no los diez minutos de la demo. */
const VALIDEZ_APROBACION_SEGUNDOS_POR_DEFECTO = 3 * 24 * 60 * 60;

function faltanVariablesOdoo(entorno: Record<string, string | undefined>): string[] {
  return ['ODOO_URL', 'ODOO_BASE', 'ODOO_USUARIO', 'ODOO_CLAVE_API'].filter(
    (nombre) => (entorno[nombre] ?? '').trim() === '',
  );
}

/** Cuántas tareas de este puesto se han lanzado ya hoy: aviso, no bloqueo. */
async function tareasDeHoy(
  cliente: postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<number> {
  const filas = await conTenant(
    cliente,
    tenantId,
    (tx) =>
      tx<{ total: string }[]>`
      select count(*)::text as total from tarea
      where tenant_id = ${tenantId} and puesto_id = ${puestoId}
        and creado_en >= date_trunc('day', now())
    `,
  );
  return Number(filas[0]?.total ?? 0);
}

export async function principal(
  entorno: Record<string, string | undefined> = process.env,
): Promise<void> {
  const urlBaseDeDatos = entorno['DATABASE_URL'];
  if (urlBaseDeDatos === undefined || urlBaseDeDatos === '') {
    console.error('Falta DATABASE_URL. Levanta el entorno local y migra antes de lanzar la tarea.');
    process.exitCode = 1;
    return;
  }
  const faltanOdoo = faltanVariablesOdoo(entorno);
  if (faltanOdoo.length > 0) {
    console.error(`Faltan variables de Odoo: ${faltanOdoo.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  if (entorno['AIW_CONECTOR_ODOO'] !== '1') {
    console.error('Falta AIW_CONECTOR_ODOO=1: sin ella, el conector de Odoo no arranca.');
    process.exitCode = 1;
    return;
  }
  const estado = leerEstadoBitclick();
  if (!estado) {
    console.error(MENSAJE_SIN_SIEMBRA);
    process.exitCode = 1;
    return;
  }

  const cola = `aiw-bitclick-cobros-${String(Date.now())}`;
  const conexionTemporal = await NativeConnection.connect({
    address: entorno['AIW_TEMPORAL_DIRECCION'] ?? 'localhost:7233',
  });
  const espacioTemporal = entorno['AIW_TEMPORAL_ESPACIO'] ?? 'default';

  const registro = registroDeOdooPorProceso({
    nombreConector: NOMBRE_CONECTOR_ODOO,
    comando: 'pnpm',
    argumentos: ['--filter', '@aiw/connector-odoo', 'iniciar'],
    entorno,
  });
  const montado = await montarTrabajador({
    urlBaseDeDatos,
    cola,
    espacio: espacioTemporal,
    conexion: conexionTemporal,
    registro,
    // Documentado arriba: el proveedor real de modelo todavía no está cableado en
    // el enrutador del bucle. El conector de Odoo, que es lo que exige esta
    // rebanada, sí es el real.
    enrutador: enrutadorDeDemostracion(),
  });

  const clienteTemporal = new Client({
    connection: await Connection.connect({
      address: entorno['AIW_TEMPORAL_DIRECCION'] ?? 'localhost:7233',
    }),
    namespace: espacioTemporal,
  });

  const yaHoy = await tareasDeHoy(montado.cliente, estado.tenantId, estado.puestoId);
  if (yaHoy > 0) {
    console.log(
      `— Aviso: hoy ya se ha lanzado ${String(yaHoy)} tarea(s) de Cobros para Bitclick. ` +
        'Cada tarea paga con un modelo; lánzala a mano y como mucho una vez al día.',
    );
  }

  const { tareaId } = await crearTareaRaiz(montado.cliente, {
    tenantId: estado.tenantId,
    puestoId: estado.puestoId,
    versionPuestoId: estado.versionPuestoId,
    presupuestoEuros: plantillaCobros().presupuestoPorTareaEuros,
  });

  console.log('— Tarea de Cobros lanzada contra el Odoo real de Bitclick.');
  console.log(`  tenant: ${estado.tenantId}`);
  console.log(`  tarea:  ${tareaId}`);
  console.log('');

  const mango = await clienteTemporal.workflow.start(tareaAgente, {
    taskQueue: cola,
    workflowId: `bitclick-cobros-${tareaId}`,
    args: [
      {
        tenantId: estado.tenantId,
        puestoId: estado.puestoId,
        versionPuestoId: estado.versionPuestoId,
        tareaId,
        encargo: ENCARGO_COBROS,
        validezAprobacionSegundos: Number(
          entorno['BITCLICK_VALIDEZ_APROBACION_SEGUNDOS'] ??
            VALIDEZ_APROBACION_SEGUNDOS_POR_DEFECTO,
        ),
        aprendizaje: false,
      },
    ],
  });

  console.log(`— Flujo ${mango.workflowId} arrancado. Si el agente propone un recordatorio, el`);
  console.log('  correo de aprobación llega a la bandeja de Jesús. Aprobarlo escribe en Odoo;');
  console.log('  rechazarlo no escribe nada.');
  console.log('');

  const resultado = await montado.trabajador.runUntil(() => mango.result());

  console.log('— Tarea terminada.');
  console.log(`  estado:               ${resultado.estado}`);
  console.log(`  resumen:              ${resultado.resumen}`);
  console.log(`  aprobaciones pedidas: ${resultado.aprobacionesPedidas}`);
  console.log(`  escrituras hechas:    ${resultado.escriturasEjecutadas}`);
  console.log(`  coste:                ${resultado.costeEuros.toFixed(4)} €`);
  console.log('');

  const verificacion = await conTenant(montado.cliente, estado.tenantId, (tx) =>
    verificarCadenaEnBase(tx, estado.tenantId),
  );
  console.log('— Libro de auditoría.');
  console.log(`  cadena verificada: ${verificacion.valida ? 'sí' : `no (${verificacion.motivo})`}`);
  console.log(`  entradas:          ${verificacion.entradas}`);

  await montado.cerrar();
  await conexionTemporal.close();
  await clienteTemporal.connection.close();
}

if (esProcesoPrincipal(import.meta.url)) {
  await principal();
}
