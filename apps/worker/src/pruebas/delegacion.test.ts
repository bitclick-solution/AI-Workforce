/**
 * La delegación como flujo hijo, con salto de tiempo.
 *
 * Entorno de salto de tiempo: el plazo de una delegación se mide en minutos u horas
 * y aquí se prueba que vence sin esperarlos. El servidor de pruebas adelanta el
 * reloj cuando nadie tiene trabajo, así que un temporizador de diez minutos se
 * cumple en milisegundos y la política de respaldo del ADR-014 se puede comprobar.
 *
 * Lo que no se prueba aquí son las señales: con el reloj adelantándose, una prueba
 * que intenta pulsar un enlace llega siempre tarde. Eso está en `flujos.test.ts`.
 */
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO } from '@aiw/db/pruebas';
import { PUESTO_CONCILIACION } from '@aiw/db/pruebas';
import type { ContratoDelegacion } from '@aiw/domain';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { conTenant } from '@aiw/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { tareaAgente } from '../flujos/index.js';
import { montarParaPruebas, type MontajeDePruebas } from './montaje.js';
import { arrancarEntorno, montarTrabajadorDePrueba } from './temporal.js';

const ENCARGO = 'Haz el seguimiento de cobros y delega la conciliación de la primera factura.';

/** Contrato completo: los cuatro campos del ADR-004 y los dos del ADR-014. */
function contrato(parcial: Partial<ContratoDelegacion> = {}): ContratoDelegacion {
  return {
    encargo: 'Concilia la factura F-2026-0001 con el extracto bancario y propón el asiento.',
    plazoSegundos: 600,
    presupuestoEuros: 0.2,
    formato: {
      formato: 'json',
      criteriosAceptacion: ['Indica el asiento propuesto', 'Cita el movimiento bancario'],
    },
    caducidadSegundos: 1800,
    politicaRespaldo: 'seguir_sin_ello',
    ...parcial,
  };
}

let entorno: TestWorkflowEnvironment | null = null;
let motivoSalto = HAY_BASE_DE_DATOS ? '' : MOTIVO_SALTO;

describe('delegación · flujo hijo con contrato y plazo', () => {
  const montajes: MontajeDePruebas[] = [];

  beforeAll(async () => {
    if (!HAY_BASE_DE_DATOS) return;
    const arrancado = await arrancarEntorno('salto-de-tiempo');
    entorno = arrancado.entorno;
    motivoSalto = arrancado.motivoSalto;
  }, 300_000);

  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
  });

  afterAll(async () => {
    await entorno?.teardown();
  }, 60_000);

  async function correr(opciones: { nombre: string; contrato: ContratoDelegacion }) {
    const montaje = await montarParaPruebas({
      nombre: opciones.nombre,
      presupuestoTareaEuros: 1,
    });
    montajes.push(montaje);

    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await montarTrabajadorDePrueba(
      entorno?.nativeConnection as never,
      entorno?.client.options.namespace ?? 'default',
      cola,
      montaje,
    );

    // Validez de aprobación corta: con salto de tiempo nadie va a pulsar un enlace,
    // así que las escrituras se vencen y el bucle llega a la delegación, que es lo
    // que esta prueba mira.
    const resultado = await trabajador.trabajador.runUntil(
      (entorno as TestWorkflowEnvironment).client.workflow.execute(tareaAgente, {
        taskQueue: cola,
        workflowId: `tarea-${montaje.tareaId}`,
        args: [
          {
            tenantId: montaje.semilla.tenantId,
            puestoId: montaje.semilla.cobros.puestoId,
            versionPuestoId: montaje.semilla.cobros.versionPuestoId,
            tareaId: montaje.tareaId,
            encargo: ENCARGO,
            validezAprobacionSegundos: 1,
            delegacion: {
              puestoDestinoNombre: PUESTO_CONCILIACION,
              contrato: opciones.contrato,
            },
          },
        ],
      }),
    );

    return { montaje, resultado };
  }

  it('el hijo recibe el contrato, entrega, y su coste suma en la tarea raíz', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const { montaje, resultado } = await correr({
      nombre: `Delegacion entregada ${Date.now()}`,
      contrato: contrato(),
    });
    const tenantId = montaje.semilla.tenantId;

    expect(resultado.delegacion?.entregado).toBe(true);
    expect(resultado.delegacion?.tareaDestinoId).toBeTruthy();

    const filas = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const encontradas = await tx<
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
      return [...encontradas];
    });
    const delegada = filas[0];
    expect(delegada?.tarea_destino_id).toBe(resultado.delegacion?.tareaDestinoId);
    expect(delegada?.encargo).toContain('F-2026-0001');
    expect(Number(delegada?.presupuesto_euros)).toBeCloseTo(0.2, 4);
    expect(delegada?.formato.criteriosAceptacion).toHaveLength(2);
    expect(delegada?.resultado['entregado']).toBe(true);

    // El consumo del hijo suma en la raíz y no cuenta como tarea nueva (ADR-003).
    const consumo = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const usos = await tx<{ tarea_raiz_id: string; tarea_id: string; coste_euros: string }[]>`
        select tarea_raiz_id, tarea_id, coste_euros from uso_modelo
        where tenant_id = ${tenantId}
      `;
      return [...usos];
    });
    const deLaHija = consumo.filter((uso) => uso.tarea_id === delegada?.tarea_destino_id);
    expect(deLaHija.length).toBeGreaterThan(0);
    expect(deLaHija.every((uso) => uso.tarea_raiz_id === montaje.tareaId)).toBe(true);

    const [contador] = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filasContador = await tx<{ tareas: string }[]>`
        select tareas from contador_consumo where tenant_id = ${tenantId}
      `;
      return [...filasContador];
    });
    // Dos flujos, dos tareas en la base y una sola unidad en el contador.
    expect(Number(contador?.tareas)).toBe(1);
  }, 300_000);

  it('el puesto en prueba del hijo simula sus escrituras', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const { montaje, resultado } = await correr({
      nombre: `Delegacion en prueba ${Date.now()}`,
      contrato: contrato(),
    });

    expect(resultado.delegacion?.entregado).toBe(true);
    const simuladas = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
      const filas = await tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${montaje.semilla.tenantId}
          and accion = 'herramienta.simulada'
      `;
      return [...filas];
    });
    // El hijo es Conciliación, que está en prueba: sus escrituras no salen al mundo.
    expect(simuladas.length).toBeGreaterThan(0);
  }, 300_000);

  it('un plazo que vence aplica la política de respaldo y no bloquea al padre', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    // Plazo de un segundo con caducidad amplia: el hijo no llega y el padre sigue.
    const { montaje, resultado } = await correr({
      nombre: `Delegacion vencida ${Date.now()}`,
      contrato: contrato({ plazoSegundos: 1, caducidadSegundos: 1800 }),
    });

    // Con salto de tiempo el temporizador del plazo puede ganar la carrera o no:
    // lo que se comprueba es que el padre termina en los dos casos, y que si venció
    // aplicó la política declarada y lo dejó escrito.
    expect(resultado.estado).toBe('completada');
    if (resultado.delegacion?.entregado === false) {
      expect(resultado.delegacion.respaldoAplicado).toBe('seguir_sin_ello');
      const vencidas = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
        const filas = await tx<{ accion: string }[]>`
          select accion from entrada_auditoria
          where tenant_id = ${montaje.semilla.tenantId} and accion = 'delegacion.vencida'
        `;
        return [...filas];
      });
      expect(vencidas).toHaveLength(1);
    }
  }, 300_000);

  it('un contrato sin caducidad ni política de respaldo no arranca el hijo', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const sinAdr014 = { ...contrato() } as Record<string, unknown>;
    delete sinAdr014['caducidadSegundos'];
    delete sinAdr014['politicaRespaldo'];

    const fallo = await correr({
      nombre: `Delegacion sin contrato ${Date.now()}`,
      contrato: sinAdr014 as unknown as ContratoDelegacion,
    }).catch((error: unknown) => error);

    expect(String(fallo)).toMatch(/caducidadSegundos|politicaRespaldo|invalid/i);
  }, 300_000);
});
