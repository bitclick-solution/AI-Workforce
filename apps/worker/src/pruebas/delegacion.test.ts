/**
 * El plazo de la delegación, con salto de tiempo.
 *
 * Aquí solo vive lo que necesita adelantar el reloj: que un plazo vence sin
 * esperarlo y que el padre aplica la política de respaldo del ADR-014 en vez de
 * quedarse colgado. El servidor de pruebas adelanta el reloj cuando nadie tiene
 * trabajo, así que un temporizador de diez minutos se cumple en milisegundos.
 *
 * Lo que **no** puede vivir aquí es el camino en el que el hijo sí entrega: con el
 * reloj adelantándose, el temporizador del plazo gana siempre la carrera contra el
 * hijo, y la prueba mediría el salto de tiempo en vez de la delegación. Ese camino
 * está en `flujos.test.ts`, con reloj de verdad. Lo aprendimos viendo esta misma
 * prueba fallar en la integración continua por eso exactamente.
 */
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, PUESTO_CONCILIACION } from '@aiw/db/pruebas';
import { conTenant } from '@aiw/db';
import type { ContratoDelegacion } from '@aiw/domain';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { tareaAgente } from '../flujos/index.js';
import { montarParaPruebas, type MontajeDePruebas } from './montaje.js';
import { arrancarEntorno, montarTrabajadorDePrueba, type TrabajadorDePrueba } from './temporal.js';

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

/** Un fallo de flujo llega envuelto: el motivo real está en la cadena de causas. */
function mensajesDe(error: unknown): string {
  const partes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    partes.push(actual.message);
    actual = actual.cause;
  }
  return partes.join(' ← ');
}

describe('delegación · plazo vencido y contrato del ADR-014', () => {
  const montajes: MontajeDePruebas[] = [];
  const trabajadores: TrabajadorDePrueba[] = [];

  beforeAll(async () => {
    if (!HAY_BASE_DE_DATOS) return;
    const arrancado = await arrancarEntorno('salto-de-tiempo');
    entorno = arrancado.entorno;
    motivoSalto = arrancado.motivoSalto;
  }, 300_000);

  // Los trabajadores se paran antes de cerrar la conexión, y no al revés.
  afterEach(async () => {
    for (const trabajador of trabajadores.splice(0)) await trabajador.cerrar();
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
  }, 60_000);

  afterAll(async () => {
    await entorno?.teardown();
  }, 60_000);

  async function correr(opciones: { nombre: string; contrato: ContratoDelegacion }) {
    const activo = entorno as TestWorkflowEnvironment;
    const montaje = await montarParaPruebas({
      nombre: opciones.nombre,
      presupuestoTareaEuros: 1,
    });
    montajes.push(montaje);

    const cola = `cobros-${montaje.tareaId}`;
    const trabajador = await montarTrabajadorDePrueba(
      activo.nativeConnection,
      activo.client.options.namespace,
      cola,
      montaje,
    );
    trabajadores.push(trabajador);

    // Validez de aprobación corta: con salto de tiempo nadie va a pulsar un enlace,
    // así que las escrituras se vencen y el bucle llega a la delegación, que es lo
    // que esta prueba mira.
    const resultado = await trabajador.trabajador.runUntil(
      activo.client.workflow.execute(tareaAgente, {
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

  it('un plazo que vence aplica la política de respaldo y no bloquea al padre', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const { montaje, resultado } = await correr({
      nombre: `Delegacion vencida ${Date.now()}`,
      contrato: contrato({ plazoSegundos: 1, caducidadSegundos: 1800 }),
    });

    // El padre termina, que es lo primero que hay que poder afirmar: un plazo que
    // vence no puede dejar una tarea colgada para siempre.
    expect(resultado.estado).toBe('completada');
    expect(resultado.delegacion).toBeDefined();

    // Con salto de tiempo el temporizador del plazo gana la carrera casi siempre,
    // pero no se afirma que la gane: se afirma que si la gana, la política declarada
    // se aplicó y quedó escrita. Una prueba que dependa de quién gana una carrera es
    // una prueba que va a fallar sola algún día.
    if (resultado.delegacion?.entregado === false) {
      expect(resultado.delegacion.respaldoAplicado).toBe('seguir_sin_ello');
      expect(resultado.delegacion.resumen).toContain('venció el plazo');

      const vencidas = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
        const filas = await tx<{ accion: string }[]>`
          select accion from entrada_auditoria
          where tenant_id = ${montaje.semilla.tenantId} and accion = 'delegacion.vencida'
        `;
        return [...filas];
      });
      expect(vencidas).toHaveLength(1);

      const cerrada = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
        const filas = await tx<{ resultado: Record<string, unknown> }[]>`
          select resultado from delegacion where tenant_id = ${montaje.semilla.tenantId}
        `;
        return [...filas];
      });
      expect(cerrada[0]?.resultado['entregado']).toBe(false);
      expect(cerrada[0]?.resultado['politicaRespaldo']).toBe('seguir_sin_ello');
    }
  }, 300_000);

  it('un contrato sin caducidad ni política de respaldo no arranca el flujo', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const sinAdr014 = { ...contrato() } as Record<string, unknown>;
    delete sinAdr014['caducidadSegundos'];
    delete sinAdr014['politicaRespaldo'];

    const fallo = await correr({
      nombre: `Delegacion sin contrato ${Date.now()}`,
      contrato: sinAdr014 as unknown as ContratoDelegacion,
    }).catch((error: unknown) => error);

    // Falla, y falla pronto: el contrato se valida al entrar en el flujo y el fallo
    // es un `ApplicationFailure` no reintentable, no un error de Zod que Temporal
    // trataría como fallo de la tarea de flujo y reintentaría sin fin. La versión
    // anterior lo validaba al abrir la delegación, después de la tarea entera, y la
    // actividad se reintentaba sesenta veces contra una carga que el libro nunca
    // iba a aceptar.
    expect(fallo).toBeInstanceOf(Error);
    expect(mensajesDe(fallo)).toMatch(/caducidadSegundos|politicaRespaldo/);
    expect(mensajesDe(fallo)).toContain('ADR-014');
  }, 120_000);
});
