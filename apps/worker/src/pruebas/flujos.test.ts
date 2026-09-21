/**
 * Los flujos durables contra un servidor de Temporal de verdad.
 *
 * Aquí se comprueba lo que no se puede comprobar sin Temporal: que una señal llega
 * mientras el flujo espera, que el flujo sobrevive al reinicio del trabajador sin
 * repetir una llamada ya hecha, que una actividad reintenta con espera creciente y
 * que al cuarto fallo la tarea pasa a fallida con el motivo.
 *
 * Entorno `local`, con reloj de verdad: una señal que llega mientras el flujo espera
 * no se puede probar con salto de tiempo, porque el salto adelanta el reloj en
 * cuanto nadie tiene trabajo y el plazo vencería antes de que la prueba pulse el
 * enlace. Los plazos largos se prueban con salto de tiempo en `delegacion.test.ts`.
 */
import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO } from '@aiw/db/pruebas';
import { HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA } from '@aiw/connector-demo';
import { PUESTO_CONCILIACION } from '@aiw/db/pruebas';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ACCIONES as ACCIONES_GATEWAY } from '@aiw/mcp-gateway';

import { decisionDeAprobacion, estadoDeLaTarea, tareaAgente } from '../flujos/index.js';
import { leerPasos, leerTarea, montarParaPruebas, type MontajeDePruebas } from './montaje.js';
import {
  arrancarEntorno,
  contarEnElLibro,
  esperarAprobacionPendiente,
  montarTrabajadorDePrueba,
  type TrabajadorDePrueba,
} from './temporal.js';

const ENCARGO = 'Haz el seguimiento de cobros de hoy y deja una nota por cada factura vencida.';

let entorno: TestWorkflowEnvironment | null = null;
let motivoSalto = HAY_BASE_DE_DATOS ? '' : MOTIVO_SALTO;

describe('flujos durables · tareaAgente con servidor de Temporal', () => {
  const montajes: MontajeDePruebas[] = [];
  const trabajadores: TrabajadorDePrueba[] = [];

  beforeAll(async () => {
    if (!HAY_BASE_DE_DATOS) return;
    const arrancado = await arrancarEntorno('local');
    entorno = arrancado.entorno;
    motivoSalto = arrancado.motivoSalto;
  }, 300_000);

  // Los trabajadores se paran antes de cerrar la conexión, y no al revés: un
  // trabajador vivo con la base cerrada reintenta contra un socket muerto y hace
  // fallar por tiempo a las pruebas siguientes.
  afterEach(async () => {
    for (const trabajador of trabajadores.splice(0)) await trabajador.cerrar();
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
  }, 60_000);

  afterAll(async () => {
    await entorno?.teardown();
  }, 60_000);

  /** Monta un trabajador y lo apunta para que `afterEach` lo pare. */
  async function trabajadorPara(cola: string, montaje: MontajeDePruebas) {
    const montado = await montarTrabajadorDePrueba(
      (entorno as TestWorkflowEnvironment).nativeConnection,
      (entorno as TestWorkflowEnvironment).client.options.namespace,
      cola,
      montaje,
    );
    trabajadores.push(montado);
    return montado;
  }

  async function preparar(opciones: {
    nombre: string;
    fallosIniciales?: number | undefined;
    presupuestoTareaEuros?: number | undefined;
  }) {
    const montaje = await montarParaPruebas({
      nombre: opciones.nombre,
      presupuestoTareaEuros: opciones.presupuestoTareaEuros ?? 1,
      ...(opciones.fallosIniciales === undefined
        ? {}
        : { fallosIniciales: opciones.fallosIniciales }),
    });
    montajes.push(montaje);
    return montaje;
  }

  function entrada(montaje: MontajeDePruebas, validezSegundos = 120) {
    return {
      tenantId: montaje.semilla.tenantId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      tareaId: montaje.tareaId,
      encargo: ENCARGO,
      validezAprobacionSegundos: validezSegundos,
    };
  }

  it('ejecuta la tarea de punta a punta con tres aprobaciones por señal', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo completo ${Date.now()}` });
    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await trabajadorPara(cola, montaje);

    const mango = await entorno.client.workflow.start(tareaAgente, {
      taskQueue: cola,
      workflowId: `tarea-${montaje.tareaId}`,
      args: [entrada(montaje)],
    });

    const resultado = await trabajador.trabajador.runUntil(async () => {
      const vistas = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const aprobacion = await esperarAprobacionPendiente(
          montaje.cliente,
          montaje.semilla.tenantId,
          montaje.tareaId,
          vistas,
        );
        expect(aprobacion.claseAccion).toBe('escritura');
        expect(aprobacion.resumen).toContain('F-2026-000');
        await mango.signal(decisionDeAprobacion, {
          tenantId: montaje.semilla.tenantId,
          aprobacionId: aprobacion.id,
          tareaId: montaje.tareaId,
          decisionId: `decision-${i}`,
          sentido: 'aprobada',
          origen: 'correo',
          personaId: montaje.semilla.personaId,
          decididaEn: new Date().toISOString(),
        });
      }
      return mango.result();
    });

    expect(resultado.estado).toBe('completada');
    expect(resultado.escriturasEjecutadas).toBe(3);
    expect(resultado.aprobacionesPedidas).toBe(3);
    expect(resultado.costeEuros).toBeGreaterThan(0);

    const tarea = await leerTarea(montaje.cliente, montaje.semilla.tenantId, montaje.tareaId);
    expect(tarea.estado).toBe('completada');
    expect(tarea.coste).toBeGreaterThan(0);
  }, 180_000);

  it('sobrevive al reinicio del trabajador sin repetir la lectura ya hecha', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo reanudacion ${Date.now()}` });
    const cola = `cobros-${montaje.tareaId}`;
    const tenantId = montaje.semilla.tenantId;

    const primero = await trabajadorPara(cola, montaje);
    const mango = await entorno.client.workflow.start(tareaAgente, {
      taskQueue: cola,
      workflowId: `tarea-${montaje.tareaId}`,
      args: [entrada(montaje)],
    });

    const vistas = new Set<string>();

    // Primer trabajador: llega hasta la primera aprobación y se muere ahí. Ya ha
    // listado las facturas, que es el paso que no se puede repetir.
    await primero.trabajador.runUntil(
      esperarAprobacionPendiente(montaje.cliente, tenantId, montaje.tareaId, vistas),
    );
    const lecturasAntes = await contarEnElLibro(montaje.cliente, tenantId, {
      accion: ACCIONES_GATEWAY.llamada,
      herramienta: HERRAMIENTA_LISTAR,
      resultado: 'exito',
    });
    expect(lecturasAntes).toBe(1);

    // Segundo trabajador con la misma cola: el flujo continúa desde el historial.
    const segundo = await trabajadorPara(cola, montaje);
    const resultado = await segundo.trabajador.runUntil(async () => {
      const pendientes = [...vistas];
      for (const [indice, aprobacionId] of pendientes.entries()) {
        await mango.signal(decisionDeAprobacion, {
          tenantId,
          aprobacionId,
          tareaId: montaje.tareaId,
          decisionId: `decision-reanuda-${indice}`,
          sentido: 'aprobada',
          origen: 'correo',
          personaId: montaje.semilla.personaId,
          decididaEn: new Date().toISOString(),
        });
      }
      for (let i = pendientes.length; i < 3; i += 1) {
        const aprobacion = await esperarAprobacionPendiente(
          montaje.cliente,
          tenantId,
          montaje.tareaId,
          vistas,
        );
        await mango.signal(decisionDeAprobacion, {
          tenantId,
          aprobacionId: aprobacion.id,
          tareaId: montaje.tareaId,
          decisionId: `decision-reanuda-${i}`,
          sentido: 'aprobada',
          origen: 'correo',
          personaId: montaje.semilla.personaId,
          decididaEn: new Date().toISOString(),
        });
      }
      return mango.result();
    });

    expect(resultado.estado).toBe('completada');
    // La llamada de lectura sigue siendo una sola en todo el libro: el reinicio no
    // la repitió, y el libro es append-only, así que no se puede haber borrado.
    const lecturasDespues = await contarEnElLibro(montaje.cliente, tenantId, {
      accion: ACCIONES_GATEWAY.llamada,
      herramienta: HERRAMIENTA_LISTAR,
      resultado: 'exito',
    });
    expect(lecturasDespues).toBe(1);
    expect(
      await contarEnElLibro(montaje.cliente, tenantId, {
        accion: ACCIONES_GATEWAY.llamada,
        herramienta: HERRAMIENTA_NOTA,
        resultado: 'exito',
      }),
    ).toBe(3);

    // Y los números de paso siguen siendo consecutivos y sin repetir.
    const pasos = await leerPasos(montaje.cliente, tenantId, montaje.tareaId);
    expect(new Set(pasos.map((paso) => paso.numero)).size).toBe(pasos.length);
  }, 240_000);

  it('reintenta el fallo del conector con espera creciente y acaba pasando', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    // Dos fallos y a la tercera responde: el tope de la actividad es cuatro intentos.
    const montaje = await preparar({
      nombre: `Flujo reintentos ${Date.now()}`,
      fallosIniciales: 2,
    });
    const cola = `cobros-${montaje.tareaId}`;
    const tenantId = montaje.semilla.tenantId;
    const trabajador = await trabajadorPara(cola, montaje);

    const mango = await entorno.client.workflow.start(tareaAgente, {
      taskQueue: cola,
      workflowId: `tarea-${montaje.tareaId}`,
      args: [entrada(montaje)],
    });

    const resultado = await trabajador.trabajador.runUntil(async () => {
      const vistas = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const aprobacion = await esperarAprobacionPendiente(
          montaje.cliente,
          tenantId,
          montaje.tareaId,
          vistas,
        );
        await mango.signal(decisionDeAprobacion, {
          tenantId,
          aprobacionId: aprobacion.id,
          tareaId: montaje.tareaId,
          decisionId: `decision-reintento-${i}`,
          sentido: 'aprobada',
          origen: 'correo',
          personaId: montaje.semilla.personaId,
          decididaEn: new Date().toISOString(),
        });
      }
      return mango.result();
    });

    expect(resultado.estado).toBe('completada');
    // Los dos fallos quedan en el libro con resultado de error: un reintento que no
    // deja rastro no se puede contar ni medir.
    expect(
      await contarEnElLibro(montaje.cliente, tenantId, {
        accion: ACCIONES_GATEWAY.llamada,
        resultado: 'error',
      }),
    ).toBe(2);
  }, 240_000);

  it('al cuarto fallo la tarea pasa a fallida con el motivo en el resultado', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo fallida ${Date.now()}`, fallosIniciales: 20 });
    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await trabajadorPara(cola, montaje);

    const fallo = await trabajador.trabajador
      .runUntil(
        entorno.client.workflow.execute(tareaAgente, {
          taskQueue: cola,
          workflowId: `tarea-${montaje.tareaId}`,
          args: [entrada(montaje)],
        }),
      )
      .catch((error: unknown) => error);

    // Temporal envuelve el fallo del flujo, así que el motivo está en la cadena de
    // causas y no en el mensaje de arriba. Lo que de verdad pide el criterio es que
    // la tarea quede `fallida` con el motivo en su fila, que es lo que se ve en el
    // panel sin abrir Temporal.
    expect(fallo).toBeInstanceOf(Error);
    expect(String(fallo)).toContain('Workflow execution failed');

    const tarea = await leerTarea(montaje.cliente, montaje.semilla.tenantId, montaje.tareaId);
    expect(tarea.estado).toBe('fallida');
    expect(JSON.stringify(tarea.resultado)).toContain(HERRAMIENTA_LISTAR);

    // Cuatro intentos: el primero y tres reintentos. Ni uno más.
    expect(
      await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
        accion: ACCIONES_GATEWAY.llamada,
        herramienta: HERRAMIENTA_LISTAR,
        resultado: 'error',
      }),
    ).toBe(4);
  }, 240_000);

  it('una aprobación que nadie contesta la vence la plataforma y el bucle sigue', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo vencimiento ${Date.now()}` });
    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await trabajadorPara(cola, montaje);

    // Validez de dos segundos: nadie pulsa nada y el flujo no se queda colgado.
    const resultado = await trabajador.trabajador.runUntil(
      entorno.client.workflow.execute(tareaAgente, {
        taskQueue: cola,
        workflowId: `tarea-${montaje.tareaId}`,
        args: [{ ...entrada(montaje, 2) }],
      }),
    );

    expect(resultado.estado).toBe('completada');
    expect(resultado.escriturasSaltadas).toBe(3);
    expect(resultado.escriturasEjecutadas).toBe(0);

    // Quien vence aquí es el flujo, con `registrarDecision` y `persona_id` nulo, así
    // que la entrada del libro es `aprobacion.rechazada` con herramienta `temporal`.
    // `aprobacion.vencida` es de la rutina que barre por `vence_en`, que es otra cosa
    // y llega en su rebanada.
    const decisiones = await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
      accion: 'aprobacion.rechazada',
      herramienta: 'temporal',
    });
    expect(decisiones).toBe(3);

    const sinPersona = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
      const filas = await tx<{ persona_id: string | null; motivo: string | null }[]>`
        select d.persona_id, d.motivo
        from decision_aprobacion d
        where d.tenant_id = ${montaje.semilla.tenantId}
      `;
      return [...filas];
    });
    expect(sinPersona).toHaveLength(3);
    expect(sinPersona.every((decision) => decision.persona_id === null)).toBe(true);
    expect(sinPersona[0]?.motivo).toContain('Vencida sin respuesta');
  }, 240_000);

  it('delega en el flujo hijo, recoge su resultado y su coste suma en la raíz', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo delegacion ${Date.now()}` });
    const cola = `cobros-${montaje.tareaId}`;
    const tenantId = montaje.semilla.tenantId;
    const trabajador = await trabajadorPara(cola, montaje);

    // Reloj de verdad: con salto de tiempo el plazo del contrato vencería antes de
    // que el hijo llegue a contestar, y lo que esta prueba mira es que contesta.
    // El vencimiento del plazo se prueba aparte, en `delegacion.test.ts`.
    const resultado = await trabajador.trabajador.runUntil(
      entorno.client.workflow.execute(tareaAgente, {
        taskQueue: cola,
        workflowId: `tarea-${montaje.tareaId}`,
        args: [
          {
            ...entrada(montaje, 1),
            delegacion: {
              puestoDestinoNombre: PUESTO_CONCILIACION,
              contrato: {
                encargo: 'Concilia la factura F-2026-0001 con el extracto bancario.',
                plazoSegundos: 120,
                presupuestoEuros: 0.2,
                formato: {
                  formato: 'json' as const,
                  criteriosAceptacion: ['Indica el asiento propuesto'],
                },
                caducidadSegundos: 600,
                politicaRespaldo: 'seguir_sin_ello' as const,
              },
            },
          },
        ],
      }),
    );

    expect(resultado.estado).toBe('completada');
    expect(resultado.delegacion?.entregado).toBe(true);
    expect(resultado.delegacion?.tareaDestinoId).toBeTruthy();

    const delegaciones = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<
        {
          id: string;
          tarea_destino_id: string | null;
          encargo: string;
          presupuesto_euros: string;
          formato: { criteriosAceptacion?: string[] };
          resultado: Record<string, unknown>;
        }[]
      >`
        select id, tarea_destino_id, encargo, presupuesto_euros, formato, resultado
        from delegacion where tenant_id = ${tenantId}
      `;
      return [...filas];
    });
    const delegada = delegaciones[0];
    expect(delegada?.tarea_destino_id).toBe(resultado.delegacion?.tareaDestinoId);
    expect(delegada?.encargo).toContain('F-2026-0001');
    expect(Number(delegada?.presupuesto_euros)).toBeCloseTo(0.2, 4);
    expect(delegada?.formato.criteriosAceptacion).toHaveLength(1);
    expect(delegada?.resultado['entregado']).toBe(true);

    // El consumo del hijo suma en la raíz del padre y no cuenta como tarea nueva.
    const usos = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<{ tarea_raiz_id: string; tarea_id: string }[]>`
        select tarea_raiz_id, tarea_id from uso_modelo where tenant_id = ${tenantId}
      `;
      return [...filas];
    });
    const delHijo = usos.filter((uso) => uso.tarea_id === delegada?.tarea_destino_id);
    expect(delHijo.length).toBeGreaterThan(0);
    expect(delHijo.every((uso) => uso.tarea_raiz_id === montaje.tareaId)).toBe(true);

    const contador = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<{ tareas: string }[]>`
        select tareas from contador_consumo where tenant_id = ${tenantId}
      `;
      return [...filas];
    });
    // Dos flujos y dos filas de tarea, una sola unidad en el contador (ADR-003).
    expect(Number(contador[0]?.tareas)).toBe(1);

    // El hijo es Conciliación, que está en prueba: sus escrituras no salen al mundo.
    const simuladas = await contarEnElLibro(montaje.cliente, tenantId, {
      accion: 'herramienta.simulada',
    });
    expect(simuladas).toBeGreaterThan(0);
  }, 300_000);

  it('la consulta del flujo devuelve el estado que se proyecta', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await preparar({ nombre: `Flujo consulta ${Date.now()}` });
    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await trabajadorPara(cola, montaje);
    const mango = await entorno.client.workflow.start(tareaAgente, {
      taskQueue: cola,
      workflowId: `tarea-${montaje.tareaId}`,
      args: [entrada(montaje, 3)],
    });

    const estado = await trabajador.trabajador.runUntil(async () => {
      await esperarAprobacionPendiente(
        montaje.cliente,
        montaje.semilla.tenantId,
        montaje.tareaId,
        new Set<string>(),
      );
      const consultado = await mango.query(estadoDeLaTarea);
      await mango.result();
      return consultado;
    });

    expect(estado.estado).toBe('esperando_aprobacion');
    expect(estado.pasos).toBeGreaterThan(0);
    expect(estado.aprobacionesPendientes.length).toBeGreaterThan(0);
  }, 240_000);
});
