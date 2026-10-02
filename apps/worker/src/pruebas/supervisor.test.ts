/**
 * Supervisor de departamento v0 contra PostgreSQL: de un hecho de la delegación al
 * aviso en la sala de Finanzas.
 *
 * Llama a la actividad como la llama el flujo y mira lo que queda en la base: el
 * mensaje, el libro, el contador y, sobre todo, lo que no cambia —la tarea, la
 * delegación, los conectores—. Necesita PostgreSQL: sin `DATABASE_URL` se salta.
 */
import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, PUESTO_CONCILIACION } from '@aiw/db/pruebas';
import { verificarCadenaEnBase } from '@aiw/ledger';
import { afterEach, describe, expect, it } from 'vitest';

import { ACCIONES_SUPERVISOR } from '../actividades/supervisor.js';
import { leerPasos, leerTarea, montarParaPruebas, type MontajeDePruebas } from './montaje.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'supervisor de departamento'
  : `supervisor de departamento — SALTADO. ${MOTIVO_SALTO}`;

const ENCARGO = 'Concilia la factura F-2026-0001 con el extracto bancario y propón el asiento.';

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  const montajes: MontajeDePruebas[] = [];

  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
  });

  async function prepararDelegacion(politica: 'seguir_sin_ello' | 'aparcar' = 'aparcar') {
    const montaje = await montarParaPruebas({
      nombre: `Supervisor ${Date.now()}-${montajes.length}`,
    });
    montajes.push(montaje);
    const { tenantId, cobros } = montaje.semilla;
    const identidad = {
      tenantId,
      puestoId: cobros.puestoId,
      versionPuestoId: cobros.versionPuestoId,
      tareaId: montaje.tareaId,
    };
    await montaje.actividades.arrancarTarea({
      ...identidad,
      flujoTemporalId: `prueba-${montaje.tareaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });
    const abierta = await montaje.actividades.abrirDelegacion({
      ...identidad,
      puestoDestinoNombre: PUESTO_CONCILIACION,
      contrato: {
        encargo: ENCARGO,
        plazoSegundos: 120,
        presupuestoEuros: 0.2,
        formato: { formato: 'json', criteriosAceptacion: ['Indica el asiento propuesto'] },
        caducidadSegundos: 600,
        politicaRespaldo: politica,
      },
    });
    return { montaje, tenantId, delegacionId: abierta.delegacionId, politica };
  }

  async function mensajesDeFinanzas(montaje: MontajeDePruebas) {
    const { tenantId, departamentoId } = montaje.semilla;
    return conTenant(
      montaje.cliente,
      tenantId,
      (tx) => tx<
        {
          id: string;
          cuerpo: string;
          autor_persona_id: string | null;
          autor_puesto_id: string | null;
          adjuntos: { tipo: string; agente?: string }[];
        }[]
      >`
        select m.id, m.cuerpo, m.autor_persona_id, m.autor_puesto_id, m.adjuntos
        from mensaje m join sala s on s.tenant_id = m.tenant_id and s.id = m.sala_id
        where m.tenant_id = ${tenantId} and s.departamento_id = ${departamentoId}
        order by m.creado_en, m.id
      `,
    );
  }

  async function accionesDelLibro(montaje: MontajeDePruebas, accion: string) {
    const { tenantId } = montaje.semilla;
    return conTenant(
      montaje.cliente,
      tenantId,
      (tx) => tx<{ puesto_id: string | null; actor_tipo: string }[]>`
        select puesto_id, actor_tipo from entrada_auditoria
        where tenant_id = ${tenantId} and accion = ${accion}
      `,
    );
  }

  it('una delegación que vence su plazo deja un aviso en la sala, una sola vez, con todos los datos', async () => {
    const { montaje, tenantId, delegacionId, politica } = await prepararDelegacion();

    const primera = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.vencida',
      politicaRespaldo: politica,
    });
    expect(primera).toMatchObject({ publicado: true, motivo: 'plazo_vencido', yaEstaba: false });

    const mensajes = await mensajesDeFinanzas(montaje);
    expect(mensajes).toHaveLength(1);
    const [mensaje] = mensajes;
    expect(mensaje?.cuerpo).toContain('Cobros → Conciliación');
    expect(mensaje?.cuerpo).toContain('F-2026-0001');
    expect(mensaje?.cuerpo).toContain('no respondió dentro del plazo');
    expect(mensaje?.cuerpo).toContain('Siguiente paso propuesto:');
    // Actor de plataforma: ni persona ni puesto como autores.
    expect(mensaje?.autor_persona_id).toBeNull();
    expect(mensaje?.autor_puesto_id).toBeNull();
    expect(mensaje?.adjuntos).toEqual([
      { tipo: 'autor_plataforma', agente: 'supervisor_departamento' },
    ]);

    // Una entrada en el libro, de la plataforma y sin puesto: no suma a ningún puesto.
    const libro = await accionesDelLibro(montaje, ACCIONES_SUPERVISOR.avisoPublicado);
    expect(libro).toEqual([{ puesto_id: null, actor_tipo: 'plataforma' }]);
    expect(
      await conTenant(montaje.cliente, tenantId, (tx) => verificarCadenaEnBase(tx, tenantId)),
    ).toMatchObject({ valida: true });
  });

  it('el respaldo aplicado de la misma delegación no duplica el mensaje ni el libro', async () => {
    const { montaje, tenantId, delegacionId, politica } = await prepararDelegacion();
    await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.vencida',
      politicaRespaldo: politica,
    });
    const segunda = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.respaldo_aplicado',
      politicaRespaldo: politica,
    });
    expect(segunda).toMatchObject({ publicado: true, yaEstaba: true });
    // Un reintento de Temporal del mismo evento tampoco duplica.
    await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.vencida',
      politicaRespaldo: politica,
    });
    expect(await mensajesDeFinanzas(montaje)).toHaveLength(1);
    expect(await accionesDelLibro(montaje, ACCIONES_SUPERVISOR.avisoPublicado)).toHaveLength(1);
  });

  it('el respaldo aplicado solo produce el mensaje con su motivo', async () => {
    const { montaje, tenantId, delegacionId, politica } =
      await prepararDelegacion('seguir_sin_ello');
    const resultado = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.respaldo_aplicado',
      politicaRespaldo: politica,
    });
    expect(resultado).toMatchObject({ publicado: true, motivo: 'respaldo_aplicado' });
    const [mensaje] = await mensajesDeFinanzas(montaje);
    expect(mensaje?.cuerpo).toContain('seguir sin el resultado');
  });

  it('una delegación que se cierra a tiempo no produce ningún mensaje', async () => {
    const { montaje, tenantId, delegacionId } = await prepararDelegacion();
    const resultado = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.cerrada',
      entregado: true,
    });
    expect(resultado).toEqual({ publicado: false, razon: 'sin_aviso' });
    expect(await mensajesDeFinanzas(montaje)).toHaveLength(0);
    expect(await accionesDelLibro(montaje, ACCIONES_SUPERVISOR.avisoPublicado)).toHaveLength(0);
  });

  it('un destino que no entrega escala: mensaje con ese motivo', async () => {
    const { montaje, tenantId, delegacionId } = await prepararDelegacion();
    const resultado = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.cerrada',
      entregado: false,
    });
    expect(resultado).toMatchObject({ publicado: true, motivo: 'resultado_escala' });
  });

  it('una delegación que no existe no publica nada', async () => {
    const { montaje, tenantId } = await prepararDelegacion();
    const resultado = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId: '01a0fd61-c6df-7bb2-8199-885542e4fc6b',
      tipo: 'delegacion.vencida',
      politicaRespaldo: 'aparcar',
    });
    expect(resultado).toEqual({ publicado: false, razon: 'delegacion_desconocida' });
  });

  it('una delegación entre departamentos no es de este supervisor', async () => {
    const { montaje, tenantId, delegacionId } = await prepararDelegacion();
    await conTenant(montaje.cliente, tenantId, async (tx) => {
      const [otro] = await tx<{ id: string }[]>`
        insert into departamento (tenant_id, nombre, estado) values (${tenantId}, 'Ventas', 'activo')
        returning id
      `;
      await tx`
        update puesto set departamento_id = ${otro?.id ?? ''}
        where tenant_id = ${tenantId} and nombre = ${PUESTO_CONCILIACION}
      `;
    });
    const resultado = await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.vencida',
      politicaRespaldo: 'aparcar',
    });
    expect(resultado).toEqual({ publicado: false, razon: 'otro_departamento' });
  });

  it('no llama a ningún conector ni modelo, no escribe fuera y no cambia la tarea ni la delegación', async () => {
    const { montaje, tenantId, delegacionId, politica } = await prepararDelegacion();
    const antes = {
      tarea: await leerTarea(montaje.cliente, tenantId, montaje.tareaId),
      pasos: await leerPasos(montaje.cliente, tenantId, montaje.tareaId),
      delegacion: await conTenant(
        montaje.cliente,
        tenantId,
        (tx) => tx`select * from delegacion where id = ${delegacionId}`,
      ),
      contador: await conTenant(
        montaje.cliente,
        tenantId,
        (tx) =>
          tx<
            Record<string, unknown>[]
          >`select * from contador_consumo where tenant_id = ${tenantId} order by 1, 2`,
      ),
      usos: await conTenant(
        montaje.cliente,
        tenantId,
        (tx) => tx`select count(*)::int as n from uso_modelo where tenant_id = ${tenantId}`,
      ),
    };

    // Todo lo que pueda tener efectos fuera de la base se sustituye por algo que lanza
    // al tocarlo: si el supervisor llamara a una herramienta o a un modelo, fallaría.
    const llamadas: string[] = [];
    const prohibido = (nombre: string) =>
      new Proxy(
        {},
        {
          get: (_objetivo, propiedad) => {
            llamadas.push(`${nombre}.${String(propiedad)}`);
            throw new Error(`El supervisor no debe tocar ${nombre}.`);
          },
        },
      );
    const contexto = montaje.contexto as unknown as Record<string, unknown>;
    contexto['gateway'] = prohibido('gateway');
    contexto['enrutador'] = prohibido('enrutador');

    await montaje.actividades.supervisarDelegacion({
      tenantId,
      delegacionId,
      tipo: 'delegacion.vencida',
      politicaRespaldo: politica,
    });
    expect(llamadas).toEqual([]);

    expect(await leerTarea(montaje.cliente, tenantId, montaje.tareaId)).toEqual(antes.tarea);
    expect(await leerPasos(montaje.cliente, tenantId, montaje.tareaId)).toEqual(antes.pasos);
    expect(
      await conTenant(
        montaje.cliente,
        tenantId,
        (tx) => tx`select * from delegacion where id = ${delegacionId}`,
      ),
    ).toEqual(antes.delegacion);
    // Cada acción suma al contador (la entrada del libro cuenta una acción), pero el aviso
    // no es una tarea, ni un paso, ni consumo de modelo: tareas, pasos y coste no se mueven.
    const despuesDelContador = await conTenant(
      montaje.cliente,
      tenantId,
      (tx) =>
        tx<
          Record<string, unknown>[]
        >`select * from contador_consumo where tenant_id = ${tenantId} order by 1, 2`,
    );
    const resumen = (filas: readonly Record<string, unknown>[]) =>
      filas.map((f) => ({ tareas: f['tareas'], pasos: f['pasos'], coste: f['coste_euros'] }));
    expect(resumen(despuesDelContador)).toEqual(resumen(antes.contador));
    expect(
      despuesDelContador.reduce((suma, f) => suma + Number(f['acciones']), 0) -
        antes.contador.reduce((suma, f) => suma + Number(f['acciones']), 0),
    ).toBe(1);
    expect(
      await conTenant(
        montaje.cliente,
        tenantId,
        (tx) => tx`select count(*)::int as n from uso_modelo where tenant_id = ${tenantId}`,
      ),
    ).toEqual(antes.usos);
  });
});
