/**
 * Montaje compartido de las pruebas del trabajador.
 *
 * Siembra Finanzas con el conector de demostración, crea la tarea y devuelve las
 * actividades ya construidas. Las mismas actividades que usa el flujo de Temporal:
 * las pruebas del bucle las llaman directamente, así que la tabla de políticas, el
 * presupuesto, la auditoría y el contador se comprueban contra PostgreSQL de verdad
 * sin necesitar un servidor de Temporal.
 *
 * Lo que sí necesita Temporal —durabilidad, reanudación, flujo hijo con plazo,
 * espera de señal— va en `flujos.test.ts`, que se salta cuando no hay servidor de
 * pruebas disponible.
 */
import { conTenant, uuidV7 } from '@aiw/db';
import { URL_BASE_DE_DATOS } from '@aiw/db/pruebas';
import { VARIABLE_SECRETO_DEMO } from '@aiw/connector-demo';
import { resolvedorDeEntorno } from '@aiw/mcp-gateway';
import { TrazasEnMemoria } from '@aiw/models';
import type postgres from 'postgres';

import { crearActividades, type Actividades } from '../actividades/index.js';
import {
  crearContextoDeActividades,
  enrutadorDeDemostracion,
  registroConDemostracion,
  type ContextoDeActividades,
} from '../actividades/contexto.js';
import { crearTareaRaiz, sembrarDemostracion, type SemillaDeDemostracion } from '../semilla.js';

/**
 * Secreto del conector para las pruebas.
 *
 * Sale del entorno cuando lo hay —el job «Flujos durables» de la integración
 * continua lo genera por ejecución— y, si no, de un identificador aleatorio de este
 * proceso. En los dos casos es un valor que nace y muere con la ejecución: no hay
 * ninguna credencial escrita en el repositorio, ni siquiera de juguete.
 */
export const SECRETO_DE_PRUEBA = process.env[VARIABLE_SECRETO_DEMO] ?? `demo-${uuidV7()}`;

export const ENTORNO_DE_PRUEBA = { [VARIABLE_SECRETO_DEMO]: SECRETO_DE_PRUEBA };

export interface OpcionesMontaje {
  nombre: string;
  presupuestoEuros?: number | undefined;
  presupuestoTareaEuros?: number | undefined;
  /** Cuántas llamadas falla el conector antes de responder. */
  fallosIniciales?: number | undefined;
}

export interface MontajeDePruebas {
  cliente: postgres.Sql;
  contexto: ContextoDeActividades;
  actividades: Actividades;
  trazas: TrazasEnMemoria;
  semilla: SemillaDeDemostracion;
  tareaId: string;
  cerrar: () => Promise<void>;
}

export async function montarParaPruebas(opciones: OpcionesMontaje): Promise<MontajeDePruebas> {
  const trazas = new TrazasEnMemoria();
  const contexto = crearContextoDeActividades({
    urlBaseDeDatos: URL_BASE_DE_DATOS ?? '',
    registro: registroConDemostracion({
      credencialEsperada: SECRETO_DE_PRUEBA,
      ...(opciones.fallosIniciales === undefined
        ? {}
        : { fallosIniciales: opciones.fallosIniciales }),
    }),
    enrutador: enrutadorDeDemostracion(),
    secretos: resolvedorDeEntorno(ENTORNO_DE_PRUEBA),
    trazas,
  });

  const semilla = await sembrarDemostracion(contexto.cliente, {
    nombre: opciones.nombre,
    ...(opciones.presupuestoEuros === undefined
      ? {}
      : { presupuestoEuros: opciones.presupuestoEuros }),
  });
  const { tareaId } = await crearTareaRaiz(contexto.cliente, {
    tenantId: semilla.tenantId,
    puestoId: semilla.cobros.puestoId,
    versionPuestoId: semilla.cobros.versionPuestoId,
    presupuestoEuros: opciones.presupuestoTareaEuros ?? 1,
  });

  return {
    cliente: contexto.cliente,
    contexto,
    actividades: crearActividades(contexto),
    trazas,
    semilla,
    tareaId,
    cerrar: contexto.cerrar,
  };
}

/** Lee la fila de la tarea. Es la proyección que mira el panel. */
export async function leerTarea(
  cliente: postgres.Sql,
  tenantId: string,
  tareaId: string,
): Promise<{ estado: string; coste: number; resultado: Record<string, unknown> }> {
  const [fila] = await conTenant(
    cliente,
    tenantId,
    (tx) => tx<{ estado: string; coste_euros: string; resultado: Record<string, unknown> }[]>`
    select estado, coste_euros, resultado from tarea
    where tenant_id = ${tenantId} and id = ${tareaId}
  `,
  );
  if (!fila) throw new Error(`La tarea ${tareaId} no existe.`);
  return {
    estado: fila.estado,
    coste: Number(fila.coste_euros),
    resultado: fila.resultado,
  };
}

/** Pasos de la tarea en orden. La prueba de idempotencia los cuenta. */
export async function leerPasos(
  cliente: postgres.Sql,
  tenantId: string,
  tareaId: string,
): Promise<{ numero: number; tipo: string; herramienta: string | null; resultado: string }[]> {
  return conTenant(
    cliente,
    tenantId,
    (tx) => tx<{ numero: number; tipo: string; herramienta: string | null; resultado: string }[]>`
    select numero, tipo, herramienta, resultado from paso
    where tenant_id = ${tenantId} and tarea_id = ${tareaId}
    order by numero asc
  `,
  );
}
