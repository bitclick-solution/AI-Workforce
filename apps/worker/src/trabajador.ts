/**
 * Arranque del trabajador de Temporal.
 *
 * Une las dos mitades: el paquete de flujos, que se compila aislado, y las
 * actividades, que reciben la conexión y el gateway. Nada más. La lógica está en el
 * bucle y en las actividades; esto es el cableado, y conviene que se lea como tal.
 */
import { existsSync } from 'node:fs';

import { Worker, type NativeConnection } from '@temporalio/worker';
import type postgres from 'postgres';

import { crearActividades } from './actividades/index.js';
import { crearContextoDeActividades, type OpcionesContexto } from './actividades/contexto.js';

/**
 * Ruta del paquete de flujos, resuelta por el propio módulo para no depender del
 * directorio de trabajo.
 *
 * Se prueban las dos extensiones porque el mismo código corre de dos formas: desde
 * el fuente con `tsx` y en las pruebas, y compilado en la imagen. El empaquetador
 * de Temporal acepta TypeScript, así que desde el fuente se le da el `.ts`.
 */
function resolverRutaDeFlujos(): string {
  const fuente = new URL('./flujos/index.ts', import.meta.url).pathname;
  return existsSync(fuente) ? fuente : new URL('./flujos/index.js', import.meta.url).pathname;
}

export const RUTA_FLUJOS = resolverRutaDeFlujos();

export interface OpcionesTrabajador extends OpcionesContexto {
  cola: string;
  /** Conexión nativa ya abierta. La abre quien arranca el proceso o la prueba. */
  conexion?: NativeConnection | undefined;
  espacio?: string | undefined;
}

export interface TrabajadorMontado {
  trabajador: Worker;
  /** Cliente de la base del contexto de actividades. Lo usa la demostración. */
  cliente: postgres.Sql;
  /** Cierra el gateway y la conexión a la base. El trabajador se para aparte. */
  cerrar: () => Promise<void>;
}

export async function montarTrabajador(opciones: OpcionesTrabajador): Promise<TrabajadorMontado> {
  const contexto = crearContextoDeActividades(opciones);

  const trabajador = await Worker.create({
    workflowsPath: RUTA_FLUJOS,
    activities: crearActividades(contexto),
    taskQueue: opciones.cola,
    ...(opciones.conexion === undefined ? {} : { connection: opciones.conexion }),
    ...(opciones.espacio === undefined ? {} : { namespace: opciones.espacio }),
    // Un trabajador de esta rebanada corre una tarea a la vez: la demostración se
    // lee mejor en orden y las pruebas no compiten por la misma base.
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 4,
  });

  return { trabajador, cliente: contexto.cliente, cerrar: contexto.cerrar };
}
