/**
 * Aprendizaje v0 en el trabajador: la edición llega al bucle, el flujo la convierte
 * en lección, Jesús la promociona y la tarea siguiente la ve en su prompt.
 *
 * La primera mitad llama a las actividades directamente contra PostgreSQL, como
 * `bucle.test.ts`: comprueba los criterios sin servidor de Temporal. La segunda
 * necesita Temporal —la tarea que espera la señal y lanza el flujo hijo de
 * aprendizaje— y se salta diciendo por qué cuando no hay servidor de pruebas.
 */
import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO } from '@aiw/db/pruebas';
import { HERRAMIENTA_NOTA } from '@aiw/connector-demo';
import { aprendizaje } from '@aiw/evals';
import {
  leerExpediente,
  promocionarLeccion,
  revertirVersion,
  type LeccionPropuesta,
} from '@aiw/learning';
import { registrarDecision, solicitarAprobacion, verificarCadenaEnBase } from '@aiw/ledger';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  PREFIJO_FLUJO_APRENDIZAJE,
  aprendizajeDeSenal,
  decisionDeAprobacion,
  tareaAgente,
} from '../flujos/index.js';
import { crearTareaConVersionActiva } from '../semilla.js';
import { montarParaPruebas, type MontajeDePruebas } from './montaje.js';
import {
  arrancarEntorno,
  esperarAprobacionPendiente,
  montarTrabajadorDePrueba,
  type TrabajadorDePrueba,
} from './temporal.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'aprendizaje v0 en el trabajador'
  : `aprendizaje v0 en el trabajador — SALTADO. ${MOTIVO_SALTO}`;

const TEXTO_EDITADO =
  'Te escribo para recordarte que la factura F-2026-0001 sigue pendiente. Un saludo.';

/** Pide una aprobación de nota como la pediría el bucle y la decide editada. */
async function editarUnaNota(montaje: MontajeDePruebas): Promise<string> {
  const { tenantId } = montaje.semilla;
  const antes = {
    conector: 'demo',
    argumentos: { factura_id: 'inv-0001', texto: 'Le recordamos que su factura está vencida.' },
  };
  const solicitada = await conTenant(montaje.cliente, tenantId, (tx) =>
    solicitarAprobacion(tx, tenantId, {
      tareaId: montaje.tareaId,
      personaId: montaje.semilla.personaId,
      claseAccion: 'escritura',
      nivelExigido: 'n1',
      borradorOpaco: { tipo: `herramienta.${HERRAMIENTA_NOTA}`, carga: antes },
      resumenLegible: 'Nota de seguimiento de F-2026-0001',
      venceEn: new Date(Date.now() + 3_600_000),
    }),
  );
  const despues = { ...antes, argumentos: { ...antes.argumentos, texto: TEXTO_EDITADO } };
  await registrarDecision(montaje.cliente, tenantId, {
    aprobacionId: solicitada.id,
    sentido: 'editada',
    edicionPrevia: { antes, despues },
    origen: 'panel',
  });
  return solicitada.id;
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let montaje: MontajeDePruebas;

  beforeAll(async () => {
    montaje = await montarParaPruebas({ nombre: `Aprendizaje ${Date.now()}` });
  });

  afterAll(async () => {
    await montaje?.cerrar();
  });

  it('la decisión editada llega al bucle con los argumentos que aprobó la persona', async () => {
    const aprobacionId = await editarUnaNota(montaje);
    const decision = await montaje.actividades.leerDecision({
      tenantId: montaje.semilla.tenantId,
      aprobacionId,
    });
    expect(decision).toMatchObject({
      sentido: 'editada',
      argumentosEditados: { factura_id: 'inv-0001', texto: TEXTO_EDITADO },
    });
  });

  it('una aprobación sin edición no se reintenta: es un error de datos', async () => {
    const { tenantId } = montaje.semilla;
    const solicitada = await conTenant(montaje.cliente, tenantId, (tx) =>
      solicitarAprobacion(tx, tenantId, {
        tareaId: montaje.tareaId,
        claseAccion: 'escritura',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'herramienta.x', carga: {} },
        resumenLegible: 'Sin editar',
      }),
    );
    await registrarDecision(montaje.cliente, tenantId, {
      aprobacionId: solicitada.id,
      sentido: 'aprobada',
      personaId: montaje.semilla.personaId,
      origen: 'panel',
    });
    await expect(
      montaje.actividades.registrarSenalDeEdicion({ tenantId, aprobacionId: solicitada.id }),
    ).rejects.toMatchObject({ nonRetryable: true, type: 'ErrorDeAprendizaje.no_es_edicion' });
  });

  it('la lección promocionada llega a la tarea siguiente y la reversión la retira', async () => {
    const { tenantId, personaId } = montaje.semilla;
    const puestoId = montaje.semilla.cobros.puestoId;
    const aprobacionId = await editarUnaNota(montaje);

    const senal = await montaje.actividades.registrarSenalDeEdicion({ tenantId, aprobacionId });
    const leccion: LeccionPropuesta = await montaje.actividades.proponerLeccionDeSenal({
      tenantId,
      senalId: senal.senalId,
      senalCreadoEn: senal.senalCreadoEn,
    });
    expect(leccion.linea).toContain('Te escribo para recordarte');

    // La tarea que arranca antes de promocionar usa la versión inicial, sin la lección.
    const antes = await crearTareaConVersionActiva(montaje.cliente, {
      tenantId,
      puestoId,
      presupuestoEuros: 1,
    });
    expect(antes.versionPuestoId).toBe(montaje.semilla.cobros.versionPuestoId);

    // Jesús la promociona a mano con la puerta real del Evaluador.
    const promocion = await promocionarLeccion(montaje.cliente, tenantId, {
      leccionId: leccion.leccionId,
      personaId,
      puerta: aprendizaje.certificarPromocion,
    });
    if (promocion.estado !== 'promocionada') {
      throw new Error(`La puerta bloqueó: ${JSON.stringify(promocion.resultados.casos)}`);
    }
    expect(promocion.resultados.casos.map((c) => c.id)).toEqual(
      expect.arrayContaining(['cobros-001', 'conciliacion-001', 'aprendizaje-001']),
    );

    // La tarea siguiente usa la versión nueva y la lección está en su prompt.
    const despues = await crearTareaConVersionActiva(montaje.cliente, {
      tenantId,
      puestoId,
      presupuestoEuros: 1,
    });
    expect(despues.versionPuestoId).toBe(promocion.versionPuestoId);
    const contextoNuevo = await montaje.actividades.leerContexto({
      tenantId,
      puestoId,
      versionPuestoId: despues.versionPuestoId,
      tareaId: despues.tareaId,
    });
    expect(contextoNuevo.sistema).toContain('Lo que ya sabes:');
    expect(contextoNuevo.sistema).toContain(leccion.linea);

    // La tarea que ya corría con la versión anterior no cambia: su versión es inmutable.
    const contextoViejo = await montaje.actividades.leerContexto({
      tenantId,
      puestoId,
      versionPuestoId: antes.versionPuestoId,
      tareaId: antes.tareaId,
    });
    expect(contextoViejo.sistema).not.toContain(leccion.linea);

    // Reversión: la tarea siguiente vuelve a la versión inicial, sin la lección.
    const revertida = await revertirVersion(montaje.cliente, tenantId, {
      puestoId,
      aVersionId: montaje.semilla.cobros.versionPuestoId,
      personaId,
    });
    expect(revertida.retiradas).toEqual([leccion.leccionId]);
    const trasRevertir = await crearTareaConVersionActiva(montaje.cliente, {
      tenantId,
      puestoId,
      presupuestoEuros: 1,
    });
    expect(trasRevertir.versionPuestoId).toBe(montaje.semilla.cobros.versionPuestoId);
    const contextoRevertido = await montaje.actividades.leerContexto({
      tenantId,
      puestoId,
      versionPuestoId: trasRevertir.versionPuestoId,
      tareaId: trasRevertir.tareaId,
    });
    expect(contextoRevertido.sistema).not.toContain(leccion.linea);

    const expediente = await leerExpediente(montaje.cliente, tenantId, puestoId);
    expect(expediente.lecciones.find((l) => l.leccionId === leccion.leccionId)?.estado).toBe(
      'retirada',
    );
    const verificacion = await conTenant(montaje.cliente, tenantId, (tx) =>
      verificarCadenaEnBase(tx, tenantId),
    );
    expect(verificacion.valida).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Con servidor de Temporal
// ---------------------------------------------------------------------------

let entorno: TestWorkflowEnvironment | null = null;
let motivoSalto = HAY_BASE_DE_DATOS ? '' : MOTIVO_SALTO;

describe('aprendizaje v0 · flujos con servidor de Temporal', () => {
  const montajes: MontajeDePruebas[] = [];
  const trabajadores: TrabajadorDePrueba[] = [];

  beforeAll(async () => {
    if (!HAY_BASE_DE_DATOS) return;
    const arrancado = await arrancarEntorno('local');
    entorno = arrancado.entorno;
    motivoSalto = arrancado.motivoSalto;
  }, 300_000);

  afterEach(async () => {
    for (const trabajador of trabajadores.splice(0)) await trabajador.cerrar();
    await Promise.all(montajes.splice(0).map((m) => m.cerrar()));
  }, 60_000);

  afterAll(async () => {
    await entorno?.teardown();
  }, 60_000);

  async function preparar(nombre: string) {
    const montaje = await montarParaPruebas({ nombre: `${nombre} ${Date.now()}` });
    montajes.push(montaje);
    const cola = `aprendizaje-${montaje.tareaId}`;
    const trabajador = await montarTrabajadorDePrueba(
      (entorno as TestWorkflowEnvironment).nativeConnection,
      (entorno as TestWorkflowEnvironment).client.options.namespace,
      cola,
      montaje,
    );
    trabajadores.push(trabajador);
    return { montaje, cola, trabajador };
  }

  it('el flujo de aprendizaje convierte la edición en lección y es idempotente', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const temporal = entorno;
    const { montaje, cola, trabajador } = await preparar('Flujo de aprendizaje');
    const aprobacionId = await editarUnaNota(montaje);
    const entrada = { tenantId: montaje.semilla.tenantId, aprobacionId };

    const [primero, segundo] = await trabajador.trabajador.runUntil(async () => {
      const uno = await temporal.client.workflow.execute(aprendizajeDeSenal, {
        taskQueue: cola,
        workflowId: `${PREFIJO_FLUJO_APRENDIZAJE}${aprobacionId}`,
        args: [entrada],
      });
      // Otra ejecución con el mismo encargo encuentra lo que hizo la primera.
      const dos = await temporal.client.workflow.execute(aprendizajeDeSenal, {
        taskQueue: cola,
        workflowId: `${PREFIJO_FLUJO_APRENDIZAJE}${aprobacionId}-repetido`,
        args: [entrada],
      });
      return [uno, dos];
    });
    expect(primero.linea).toContain('Te escribo para recordarte');
    expect(segundo).toEqual(primero);
  }, 120_000);

  it('una edición durante la tarea ejecuta lo editado y lanza el aprendizaje', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const temporal = entorno;
    const { montaje, cola, trabajador } = await preparar('Tarea con edición');
    const { tenantId } = montaje.semilla;

    const mango = await entorno.client.workflow.start(tareaAgente, {
      taskQueue: cola,
      workflowId: `tarea-${montaje.tareaId}`,
      args: [
        {
          tenantId,
          puestoId: montaje.semilla.cobros.puestoId,
          versionPuestoId: montaje.semilla.cobros.versionPuestoId,
          tareaId: montaje.tareaId,
          encargo: 'Haz el seguimiento de cobros de hoy y deja una nota por cada factura vencida.',
          validezAprobacionSegundos: 120,
          aprendizaje: true,
        },
      ],
    });

    const { resultado, leccion } = await trabajador.trabajador.runUntil(async () => {
      const vistas = new Set<string>();
      let editadaId = '';
      for (let i = 0; i < 3; i += 1) {
        const aprobacion = await esperarAprobacionPendiente(
          montaje.cliente,
          tenantId,
          montaje.tareaId,
          vistas,
        );
        if (i === 0) {
          // La primera nota la edita la persona antes de aprobarla.
          const [fila] = await conTenant(
            montaje.cliente,
            tenantId,
            (tx) => tx<{ carga: { conector: string; argumentos: Record<string, unknown> } }[]>`
              select borrador_opaco->'carga' as carga from aprobacion
              where tenant_id = ${tenantId} and id = ${aprobacion.id}
            `,
          );
          if (!fila) throw new Error(`No se encontró el borrador de ${aprobacion.id}.`);
          const antes = fila.carga;
          const despues = { ...antes, argumentos: { ...antes.argumentos, texto: TEXTO_EDITADO } };
          const registrada = await registrarDecision(montaje.cliente, tenantId, {
            aprobacionId: aprobacion.id,
            sentido: 'editada',
            edicionPrevia: { antes, despues },
            origen: 'panel',
          });
          editadaId = aprobacion.id;
          await mango.signal(decisionDeAprobacion, {
            tenantId,
            aprobacionId: aprobacion.id,
            tareaId: montaje.tareaId,
            decisionId: registrada.estado === 'registrada' ? registrada.decision.id : 'x',
            sentido: 'editada',
            origen: 'panel',
            personaId: montaje.semilla.personaId,
            decididaEn: new Date().toISOString(),
          });
        } else {
          await mango.signal(decisionDeAprobacion, {
            tenantId,
            aprobacionId: aprobacion.id,
            tareaId: montaje.tareaId,
            decisionId: `decision-${i}`,
            sentido: 'aprobada',
            origen: 'correo',
            personaId: montaje.semilla.personaId,
            decididaEn: new Date().toISOString(),
          });
        }
      }
      const final = await mango.result();
      const hijo = temporal.client.workflow.getHandle(`${PREFIJO_FLUJO_APRENDIZAJE}${editadaId}`);
      return { resultado: final, leccion: await hijo.result() };
    });

    expect(resultado.estado).toBe('completada');
    expect(resultado.escriturasEjecutadas).toBe(3);
    expect(leccion.linea).toContain('Te escribo para recordarte');

    // Lo que se ejecutó fue lo editado, y hubo una sola señal por la edición.
    const [conteo] = await conTenant(
      montaje.cliente,
      tenantId,
      (tx) => tx<{ editadas: string; senales: string }[]>`
        select
          (select count(*) from paso where tenant_id = ${tenantId} and tarea_id = ${montaje.tareaId}
            and entrada::text like ${`%${TEXTO_EDITADO}%`})::text as editadas,
          (select count(*) from senal where tenant_id = ${tenantId} and tipo = 'correccion')::text as senales
      `,
    );
    expect(Number(conteo?.editadas)).toBeGreaterThan(0);
    expect(Number(conteo?.senales)).toBe(1);
  }, 180_000);
});
