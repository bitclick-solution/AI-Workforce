/**
 * El puerto real del inicio contra PostgreSQL: agentes con su estado de ciclo de
 * vida y sus tareas, avisos por persona, encargar y decidir en línea, con RLS y
 * aislamiento entre organizaciones (criterio de hecho 10).
 *
 * Los flujos y Centrifugo son falsos: aquí se prueba lo que lee y escribe la base;
 * que Temporal ejecuta de verdad el flujo lo prueba `apps/worker`.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import { ROL_APLICACION, aplicarMigraciones, conTenant, crearConexion, uuidV7 } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  conectar,
  sembrarFinanzas,
} from '@aiw/db/pruebas';
import { anotar, solicitarAprobacion, verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { puertoInicio, type ConfiguracionInicio } from '../rutas/inicio';
import type { ClienteDeFlujos } from '../rutas/sala';

const TITULO = HAY_BASE_DE_DATOS
  ? 'puerto del inicio'
  : `puerto del inicio — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  const arrancados: { nombre: string; id: string; cola: string; args: unknown[] }[] = [];
  const senales: { id: string; senal: string; carga: unknown }[] = [];
  const flujos: ClienteDeFlujos = {
    arrancar: (nombre, opciones) => {
      arrancados.push({ nombre, id: opciones.id, cola: opciones.cola, args: opciones.args });
      return Promise.resolve();
    },
    senalar: (id, senal, carga) => {
      senales.push({ id, senal, carga });
      return Promise.resolve();
    },
  };
  const configuracion: ConfiguracionInicio = {
    temporal: { direccion: 'localhost:7233', espacio: 'default', cola: 'cola-del-inicio' },
  };

  let tenantId = '';
  let personaId = '';
  let departamentoId = '';
  let salaId = '';
  let cobrosId = '';
  let conciliacionId = '';
  let otroTenantId = '';

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    const sembrado = await sembrarFinanzas(cliente, {
      nombre: `Inicio puerto ${uuidV7()}`,
      conector: 'demo-cobros',
      referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
      listaBlanca: ['listar_facturas_vencidas'],
    });
    tenantId = sembrado.tenantId;
    personaId = sembrado.personaId;
    departamentoId = sembrado.departamentoId;
    cobrosId = sembrado.cobros.puestoId;
    conciliacionId = sembrado.conciliacion.puestoId;

    // La sala del departamento la crea `sincronizarSalaDeEquipo` en producción
    // (Sala v1, `apps/worker`); aquí se inserta a mano, como ya hace
    // `sala-puerto.test.ts` con la sala general.
    salaId = await conTenant(cliente, tenantId, async (tx) => {
      const [sala] = await tx<{ id: string }[]>`
        insert into sala (tenant_id, ambito, nombre, departamento_id)
        values (${tenantId}, 'departamento', 'Sala de Finanzas', ${departamentoId})
        returning id
      `;
      return sala?.id ?? '';
    });

    const otro = await sembrarFinanzas(cliente, {
      nombre: `Inicio puerto ajeno ${uuidV7()}`,
      conector: 'demo-cobros',
      referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
      listaBlanca: ['listar_facturas_vencidas'],
      soloCobros: true,
    });
    otroTenantId = otro.tenantId;

    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });
  });

  afterAll(async () => {
    await conexion?.cerrar();
    await cliente?.end({ timeout: 5 });
  });

  it('agentes: Cobros activo y Conciliación en prueba, con su sala y sin tareas todavía', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const agentes = await puerto.agentes(tenantId);
    expect(agentes).toHaveLength(2);
    const cobros = agentes.find((a) => a.puestoId === cobrosId);
    expect(cobros).toMatchObject({
      nombre: 'Cobros',
      estado: 'activo',
      departamento: 'Finanzas',
      salaId,
      origenPlantilla: true,
      tareaEnCurso: null,
      ultimasCompletadas: [],
    });
    const conciliacion = agentes.find((a) => a.puestoId === conciliacionId);
    expect(conciliacion?.estado).toBe('en_prueba');
  });

  it('otra organización no ve estos agentes (criterio de hecho 10)', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const agentes = await puerto.agentes(otroTenantId);
    expect(agentes.map((a) => a.puestoId)).not.toContain(cobrosId);
  });

  it('puestoAdmiteEncargo: activo sí, dado de baja o sin versión activa no', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    expect(await puerto.puestoAdmiteEncargo(tenantId, cobrosId)).toBe(true);
    expect(await puerto.puestoAdmiteEncargo(tenantId, uuidV7())).toBe(false);
    expect(await puerto.puestoAdmiteEncargo(otroTenantId, cobrosId)).toBe(false);
  });

  it('crearTareaDeEncargo inserta, cuenta, arranca el flujo y aparece en «tarea en curso»', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const antes = arrancados.length;
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Revisa las facturas vencidas de hoy.',
    });
    expect(tareaId).toBeTruthy();
    expect(arrancados.slice(antes)).toEqual([
      {
        nombre: 'tareaAgente',
        id: `inicio-encargo-${tareaId}`,
        cola: 'cola-del-inicio',
        args: [expect.objectContaining({ tenantId, puestoId: cobrosId, tareaId })],
      },
    ]);

    const acciones = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${tenantId} and tarea_id = ${tareaId} and accion = 'tarea.contada'
      `,
    );
    expect(acciones).toHaveLength(1);
    expect((await verificarCadenaEnBase(cliente, tenantId)).valida).toBe(true);

    const agentes = await puerto.agentes(tenantId);
    const cobros = agentes.find((a) => a.puestoId === cobrosId);
    expect(cobros?.tareaEnCurso).toMatchObject({
      tareaId,
      encargo: 'Revisa las facturas vencidas de hoy.',
    });
  });

  it('avisos: solo los de la persona a la que se le pidió la aprobación', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Encargo con una aprobación pendiente.',
    });
    const aprobacionId = await conTenant(cliente, tenantId, async (tx) => {
      const [fila] = await tx<{ id: string }[]>`
        insert into aprobacion (tenant_id, tarea_id, persona_id, clase_accion, nivel_exigido, resumen_legible)
        values (${tenantId}, ${tareaId}, ${personaId}, 'escritura_erp', 'n1', 'Enviar la nota de seguimiento.')
        returning id
      `;
      return fila?.id ?? '';
    });

    const avisos = await puerto.avisos(tenantId, personaId);
    expect(avisos.map((a) => a.aprobacionId)).toContain(aprobacionId);
    expect(await puerto.avisos(tenantId, uuidV7())).toEqual([]);
    expect(await puerto.avisos(otroTenantId, personaId)).toEqual([]);
  });

  it('decidirAprobacion registra la decisión, la anota y señala el flujo', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Encargo con otra aprobación.',
    });
    const flujoTemporalId = `inicio-encargo-${tareaId}`;
    const aprobacionId = await conTenant(cliente, tenantId, async (tx) => {
      const [fila] = await tx<{ id: string }[]>`
        insert into aprobacion (tenant_id, tarea_id, persona_id, clase_accion, nivel_exigido, resumen_legible)
        values (${tenantId}, ${tareaId}, ${personaId}, 'escritura_erp', 'n1', 'Enviar otra nota.')
        returning id
      `;
      await tx`update tarea set flujo_temporal_id = ${flujoTemporalId} where tenant_id = ${tenantId} and id = ${tareaId}`;
      return fila?.id ?? '';
    });

    const antes = senales.length;
    const resultado = await puerto.decidirAprobacion(tenantId, {
      aprobacionId,
      personaId,
      sentido: 'aprobada',
    });
    expect(resultado).toEqual({ decidida: true });
    expect(senales.slice(antes)).toEqual([
      {
        id: flujoTemporalId,
        senal: 'decisionDeAprobacion',
        carga: expect.objectContaining({ aprobacionId, sentido: 'aprobada', origen: 'panel' }),
      },
    ]);

    const otraVez = await puerto.decidirAprobacion(tenantId, {
      aprobacionId,
      personaId,
      sentido: 'aprobada',
    });
    expect(otraVez.decidida).toBe(false);
    expect(senales).toHaveLength(antes + 1);
  });

  it('detalleDeTarea: pasos en orden del libro, coste, nivel, porqué y aprobación pendiente', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Prepara la nota para Contoso.',
    });
    const versionPuestoId = await conTenant(cliente, tenantId, async (tx) => {
      const [fila] = await tx<{ version_puesto_id: string }[]>`
        select version_puesto_id from tarea where tenant_id = ${tenantId} and id = ${tareaId}
      `;
      return fila?.version_puesto_id ?? '';
    });
    const aprobacionId = await conTenant(cliente, tenantId, async (tx) => {
      const base = { actorTipo: 'agente', puestoId: cobrosId, versionPuestoId, tareaId } as const;
      await anotar(tx, tenantId, {
        ...base,
        accion: 'herramienta.llamada',
        herramienta: 'listar_facturas_vencidas',
        datosReferenciados: [{ tipo: 'clase_accion', id: 'lectura_erp' }],
        resultado: 'exito',
        costeEuros: 0.0023,
        nivelAplicado: 'n0',
      });
      // Ruido técnico: no es un paso, pero su coste sí cuenta.
      await anotar(tx, tenantId, {
        ...base,
        accion: 'modelo.uso',
        resultado: 'exito',
        costeEuros: 0.01,
      });
      await anotar(tx, tenantId, {
        ...base,
        accion: 'herramienta.rechazada',
        herramienta: 'borrar_factura',
        datosReferenciados: [{ tipo: 'motivo', id: 'La clase está prohibida para este puesto.' }],
        resultado: 'rechazado',
        nivelAplicado: 'n0',
      });
      const solicitada = await solicitarAprobacion(tx, tenantId, {
        tareaId,
        personaId,
        claseAccion: 'escritura_erp',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'nota', carga: { opaco: true } },
        resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
      });
      return solicitada.id;
    });

    const detalle = await puerto.detalleDeTarea(tenantId, personaId, tareaId);
    expect(detalle).toMatchObject({
      tareaId,
      encargo: 'Prepara la nota para Contoso.',
      agente: 'Cobros',
      departamento: 'Finanzas',
      puestoId: cobrosId,
    });
    expect(detalle?.costeEuros).toBeCloseTo(0.0123, 4);
    expect(detalle?.pasos.map((p) => [p.tipo, p.accion])).toEqual([
      ['arranque', 'tarea.contada'],
      ['herramienta', 'herramienta.llamada'],
      ['herramienta', 'herramienta.rechazada'],
      ['aprobacion_pedida', 'aprobacion.solicitada'],
    ]);
    const ordenes = detalle?.pasos.map((p) => p.orden) ?? [];
    expect(ordenes).toEqual([...ordenes].sort((a, b) => a - b));
    expect(detalle?.pasos[1]).toMatchObject({
      herramienta: 'listar_facturas_vencidas',
      nivel: 'n0',
      claseAccion: 'lectura_erp',
      porque: null,
      resultado: 'exito',
    });
    expect(detalle?.pasos[2]).toMatchObject({
      resultado: 'rechazado',
      porque: 'La clase está prohibida para este puesto.',
    });
    expect(detalle?.aprobacionPendiente).toMatchObject({
      aprobacionId,
      claseAccion: 'escritura_erp',
      nivelExigido: 'n1',
      resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
      puedeDecidir: true,
    });

    // A otra persona de la misma organización se le enseña el resumen, pero no puede decidir.
    const deOtra = await puerto.detalleDeTarea(tenantId, uuidV7(), tareaId);
    expect(deOtra?.aprobacionPendiente?.puedeDecidir).toBe(false);

    // Decidida, deja de estar pendiente y la decisión aparece como paso.
    await puerto.decidirAprobacion(tenantId, { aprobacionId, personaId, sentido: 'aprobada' });
    const despues = await puerto.detalleDeTarea(tenantId, personaId, tareaId);
    expect(despues?.aprobacionPendiente).toBeNull();
    expect(despues?.pasos.at(-1)).toMatchObject({
      tipo: 'decision',
      accion: 'aprobacion.aprobada',
    });
  });

  it('detalleDeTarea: una tarea recién encargada tiene el arranque y ninguna aprobación', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Tarea sin pasos del agente.',
    });
    const detalle = await puerto.detalleDeTarea(tenantId, personaId, tareaId);
    expect(detalle?.estado).toBe('pendiente');
    expect(detalle?.pasos.map((p) => p.tipo)).toEqual(['arranque']);
    expect(detalle?.aprobacionPendiente).toBeNull();
  });

  it('detalleDeTarea: otra organización no ve la tarea ni nada de ella (criterio de hecho 6)', async () => {
    const puerto = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Tarea que la otra organización no debe ver.',
    });
    expect(await puerto.detalleDeTarea(otroTenantId, personaId, tareaId)).toBeNull();
    expect(await puerto.detalleDeTarea(tenantId, personaId, uuidV7())).toBeNull();
  });
});
