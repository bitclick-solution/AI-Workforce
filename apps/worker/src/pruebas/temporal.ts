/**
 * Ayudas para las pruebas que sí necesitan un servidor de Temporal.
 *
 * `@temporalio/testing` descarga su servidor de pruebas la primera vez. En la
 * integración continua funciona; en un entorno sin salida a `temporal.download` no,
 * y entonces estas pruebas se saltan con el motivo escrito, igual que las de base de
 * datos se saltan sin `DATABASE_URL`. Saltarse una prueba diciendo por qué es
 * honesto; fingir que pasa, no.
 */
import { Worker, type NativeConnection } from '@temporalio/worker';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { conTenant } from '@aiw/db';
import type postgres from 'postgres';

import { crearActividades } from '../actividades/index.js';
import { RUTA_FLUJOS } from '../trabajador.js';
import type { MontajeDePruebas } from './montaje.js';

export type ClaseDeEntorno = 'local' | 'salto-de-tiempo';

export interface EntornoDePruebas {
  entorno: TestWorkflowEnvironment | null;
  motivoSalto: string;
}

/**
 * Arranca el entorno de pruebas de Temporal, o explica por qué no se pudo.
 *
 * `local` levanta un servidor de verdad con reloj de verdad: es lo que hace falta
 * para probar una señal que llega mientras el flujo espera. `salto-de-tiempo`
 * adelanta el reloj cuando nadie tiene trabajo, que es lo que hace falta para
 * probar un plazo de horas sin esperarlas.
 */
export async function arrancarEntorno(clase: ClaseDeEntorno): Promise<EntornoDePruebas> {
  const { TestWorkflowEnvironment } = await import('@temporalio/testing');
  // Sin salida a `temporal.download`, el binario del CLI de Temporal se puede traer
  // aparte (por ejemplo de sus versiones en GitHub) y apuntar aquí. Solo sirve para
  // el servidor local; el de salto de tiempo sigue necesitando la descarga.
  const cli = process.env['AIW_TEMPORAL_CLI'];
  try {
    const entorno =
      clase === 'local'
        ? await TestWorkflowEnvironment.createLocal(
            cli ? { server: { executable: { type: 'existing-path', path: cli } } } : {},
          )
        : await TestWorkflowEnvironment.createTimeSkipping();
    return { entorno, motivoSalto: '' };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    return {
      entorno: null,
      motivoSalto:
        'Sin servidor de pruebas de Temporal: @temporalio/testing no pudo obtener su ' +
        `binario (${detalle.slice(0, 160)}). En la integración continua se descarga ` +
        'y estas pruebas se ejecutan.',
    };
  }
}

export interface TrabajadorDePrueba {
  trabajador: Worker;
  /**
   * Para el trabajador y espera a que termine de parar.
   *
   * Hay que llamarlo aunque la prueba falle. Un trabajador que sigue vivo cuando la
   * prueba ya cerró su conexión a la base reintenta actividades contra un socket
   * cerrado, se come el pool del servidor de pruebas y hace fallar por tiempo a las
   * pruebas siguientes. Se aprendió mirando el registro de la integración continua.
   */
  cerrar: () => Promise<void>;
}

/** Monta un trabajador contra el entorno de pruebas con las actividades del montaje. */
export async function montarTrabajadorDePrueba(
  conexion: NativeConnection,
  espacio: string,
  cola: string,
  montaje: MontajeDePruebas,
): Promise<TrabajadorDePrueba> {
  const trabajador = await Worker.create({
    connection: conexion,
    namespace: espacio,
    taskQueue: cola,
    workflowsPath: RUTA_FLUJOS,
    activities: crearActividades(montaje.contexto),
    // Sin reintentos de tarea de flujo más largos de lo que dura una prueba.
    stickyQueueScheduleToStartTimeout: '1 second',
    shutdownGraceTime: '1 second',
  });
  return {
    trabajador,
    cerrar: async () => {
      try {
        trabajador.shutdown();
      } catch {
        // Ya estaba parado: `runUntil` lo para cuando su promesa se resuelve.
      }
      // Se espera a que pare de verdad, no a que le hayamos pedido parar: hasta que
      // no está en `STOPPED` puede seguir ejecutando una actividad.
      const hasta = Date.now() + 10_000;
      while (trabajador.getState() !== 'STOPPED' && Date.now() < hasta) {
        await new Promise((listo) => setTimeout(listo, 50));
      }
    },
  };
}

/**
 * Espera a que aparezca una aprobación sin decidir que no se haya visto antes.
 *
 * Mira la base y no el flujo: quien decide en producción es una persona con un
 * enlace de correo, y lo único que esa persona ve es la fila de `aprobacion`. La
 * prueba hace lo mismo.
 */
export async function esperarAprobacionPendiente(
  cliente: postgres.Sql,
  tenantId: string,
  tareaId: string,
  yaVistas: Set<string>,
  limiteMs = 20_000,
): Promise<{ id: string; claseAccion: string; resumen: string }> {
  const hasta = Date.now() + limiteMs;
  while (Date.now() < hasta) {
    const filas = await conTenant(cliente, tenantId, async (tx) => {
      const encontradas = await tx<{ id: string; clase_accion: string; resumen_legible: string }[]>`
        select a.id, a.clase_accion, a.resumen_legible
        from aprobacion a
        where a.tenant_id = ${tenantId} and a.tarea_id = ${tareaId}
          and not exists (
            select 1 from decision_aprobacion d
            where d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
          )
        order by a.creado_en asc
      `;
      return [...encontradas];
    });
    const nueva = filas.find((fila) => !yaVistas.has(fila.id));
    if (nueva) {
      yaVistas.add(nueva.id);
      return { id: nueva.id, claseAccion: nueva.clase_accion, resumen: nueva.resumen_legible };
    }
    await new Promise((listo) => setTimeout(listo, 100));
  }
  throw new Error(`No apareció ninguna aprobación pendiente nueva para la tarea ${tareaId}.`);
}

/** Cuántas veces se anotó una herramienta con un resultado dado. */
export async function contarEnElLibro(
  cliente: postgres.Sql,
  tenantId: string,
  filtro: { accion: string; herramienta?: string | undefined; resultado?: string | undefined },
): Promise<number> {
  const filas = await conTenant(cliente, tenantId, async (tx) => {
    const encontradas = await tx<
      { accion: string; herramienta: string | null; resultado: string }[]
    >`
      select accion, herramienta, resultado from entrada_auditoria
      where tenant_id = ${tenantId}
    `;
    return [...encontradas];
  });
  return filas.filter(
    (fila) =>
      fila.accion === filtro.accion &&
      (filtro.herramienta === undefined || fila.herramienta === filtro.herramienta) &&
      (filtro.resultado === undefined || fila.resultado === filtro.resultado),
  ).length;
}
