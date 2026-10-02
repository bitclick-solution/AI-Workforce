/**
 * El puerto real del expediente contra PostgreSQL: versiones con su política,
 * historial de niveles derivado, lecciones, acciones rechazadas por política y avance
 * hacia el ascenso, con RLS y aislamiento entre organizaciones.
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
import { anotar, solicitarAprobacion } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { puertoExpediente } from '../rutas/expediente';
import { puertoInicio, type ConfiguracionInicio } from '../rutas/inicio';
import type { ClienteDeFlujos } from '../rutas/sala';

const TITULO = HAY_BASE_DE_DATOS
  ? 'puerto del expediente'
  : `puerto del expediente — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  let tenantId = '';
  let personaId = '';
  let cobrosId = '';
  let conciliacionId = '';
  let version2 = '';
  let version3 = '';
  let leccionId = '';
  let otroTenantId = '';
  let otroCobrosId = '';
  let tareaDeRechazo = '';

  const flujos: ClienteDeFlujos = {
    arrancar: () => Promise.resolve(),
    senalar: () => Promise.resolve(),
  };
  const configuracion: ConfiguracionInicio = {
    temporal: { direccion: 'localhost:7233', espacio: 'default', cola: 'cola-del-expediente' },
  };
  const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    const s = await sembrarFinanzas(cliente, {
      nombre: `Expediente ${uuidV7()}`,
      conector: 'demo-cobros',
      referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
      listaBlanca: ['listar_facturas_vencidas'],
    });
    tenantId = s.tenantId;
    personaId = s.personaId;
    cobrosId = s.cobros.puestoId;
    conciliacionId = s.conciliacion.puestoId;

    const otro = await sembrarFinanzas(cliente, {
      nombre: `Expediente ajeno ${uuidV7()}`,
      conector: 'demo-cobros',
      referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
      listaBlanca: ['listar_facturas_vencidas'],
      soloCobros: true,
    });
    otroTenantId = otro.tenantId;
    otroCobrosId = otro.cobros.puestoId;

    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });

    // Tres versiones de Cobros: la tercera sube «escritura» a N2 por una lección promocionada.
    await conTenant(cliente, tenantId, async (tx) => {
      const v2 = await tx<{ id: string }[]>`
        insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica, creado_en)
        values (${tenantId}, ${cobrosId}, 2, 'v2',
          ${JSON.stringify({ niveles: { lectura: 'n3', escritura: 'n1' } })}::text::jsonb,
          ${dia(30)})
        returning id
      `;
      version2 = v2[0]?.id ?? '';
      const [leccion] = await tx<{ id: string }[]>`
        insert into leccion (tenant_id, puesto_id, titulo, contenido, parametros)
        values (${tenantId}, ${cobrosId}, 'Saluda por el nombre', '{}'::jsonb,
          '{"valor":"Saluda por el nombre de la persona."}'::jsonb)
        returning id
      `;
      leccionId = leccion?.id ?? '';
      const v3 = await tx<{ id: string }[]>`
        insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica, lecciones_origen, creado_en)
        values (${tenantId}, ${cobrosId}, 3, 'v3',
          ${JSON.stringify({ niveles: { lectura: 'n3', escritura: 'n2' } })}::text::jsonb,
          ${JSON.stringify([{ leccionId, senalIds: [], promocionadaPorPersonaId: personaId }])}::text::jsonb,
          ${dia(10)})
        returning id
      `;
      version3 = v3[0]?.id ?? '';
      await tx`
        insert into promocion (tenant_id, leccion_id, version_puesto_resultante_id, decidida_por_persona_id)
        values (${tenantId}, ${leccionId}, ${version3}, ${personaId})
      `;
      await tx`update puesto set version_activa_id = ${version3} where tenant_id = ${tenantId} and id = ${cobrosId}`;
    });

    // Un puesto de otra organización con una acción rechazada: no debe aparecer en el nuestro.
    const ajeno = puertoInicio(conexion.cliente, flujos, configuracion);
    const { tareaId: tareaAjena } = await ajeno.crearTareaDeEncargo(otroTenantId, {
      puestoId: otroCobrosId,
      personaId: otro.personaId,
      encargo: 'Ajena.',
    });
    await conTenant(cliente, otroTenantId, async (tx) => {
      await anotar(tx, otroTenantId, {
        actorTipo: 'agente',
        puestoId: otroCobrosId,
        tareaId: tareaAjena,
        accion: 'herramienta.rechazada',
        herramienta: 'ajena',
        datosReferenciados: [{ tipo: 'clase_accion', id: 'comunicar' }],
        resultado: 'rechazado',
      });
    });

    // Entradas del libro del puesto de Cobros y de Conciliación.
    const { tareaId } = await ajeno.crearTareaDeEncargo(tenantId, {
      puestoId: cobrosId,
      personaId,
      encargo: 'Prepara la nota.',
    });
    tareaDeRechazo = tareaId;
    const { tareaId: tareaConciliacion } = await ajeno.crearTareaDeEncargo(tenantId, {
      puestoId: conciliacionId,
      personaId,
      encargo: 'Concilia.',
    });
    await conTenant(cliente, tenantId, async (tx) => {
      const base = { actorTipo: 'agente', puestoId: cobrosId, tareaId } as const;
      for (let i = 0; i < 3; i += 1) {
        await anotar(tx, tenantId, {
          ...base,
          accion: 'herramienta.llamada',
          herramienta: 'anotar_seguimiento',
          datosReferenciados: [{ tipo: 'clase_accion', id: 'escritura' }],
          resultado: 'exito',
          nivelAplicado: 'n1',
        });
      }
      await anotar(tx, tenantId, {
        ...base,
        accion: 'herramienta.rechazada',
        herramienta: 'enviar_tercer_aviso',
        datosReferenciados: [
          { tipo: 'clase_accion', id: 'comunicar' },
          { tipo: 'motivo', id: 'La política del puesto exige permiso para esta clase.' },
        ],
        resultado: 'rechazado',
        nivelAplicado: 'n0',
      });
      // Herramienta inventada: rechazada, pero no por política (sin clase de acción).
      await anotar(tx, tenantId, {
        ...base,
        accion: 'herramienta.rechazada',
        herramienta: 'no_existe',
        datosReferenciados: [{ tipo: 'motivo', id: 'No está en el catálogo.' }],
        resultado: 'rechazado',
      });
      // Una entrada de otro puesto de la misma organización: tampoco debe aparecer.
      await anotar(tx, tenantId, {
        actorTipo: 'agente',
        puestoId: conciliacionId,
        tareaId: tareaConciliacion,
        accion: 'herramienta.rechazada',
        herramienta: 'casar_apunte',
        datosReferenciados: [{ tipo: 'clase_accion', id: 'escritura' }],
        resultado: 'rechazado',
      });
      // Aprobaciones de la clase «escritura»: dos sin cambios y una editada.
      for (const sentido of ['aprobada', 'aprobada', 'editada'] as const) {
        const a = await solicitarAprobacion(tx, tenantId, {
          tareaId,
          personaId,
          claseAccion: 'escritura',
          nivelExigido: 'n1',
          borradorOpaco: { tipo: 'nota', carga: {} },
          resumenLegible: 'Nota de seguimiento.',
        });
        await tx`
          insert into decision_aprobacion (tenant_id, aprobacion_id, persona_id, sentido)
          values (${tenantId}, ${a.id}, ${personaId}, ${sentido})
        `;
      }
    });
  });

  afterAll(async () => {
    await conexion?.cerrar();
    await cliente?.end({ timeout: 5 });
  });

  it('compone versión activa, versiones con su política, lecciones y clases (criterio 1)', async () => {
    const e = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    expect(e).toMatchObject({
      puestoId: cobrosId,
      nombre: 'Cobros',
      departamento: 'Finanzas',
      versionActiva: { versionPuestoId: version3, numero: 3 },
    });
    expect(e?.versiones.map((v) => v.numero)).toEqual([1, 2, 3]);
    expect(e?.versiones[2]?.niveles).toEqual({ lectura: 'n3', escritura: 'n2' });
    expect(e?.lecciones).toMatchObject([
      { leccionId, titulo: 'Saluda por el nombre', estado: 'vigente', versionPuestoId: version3 },
    ]);
    expect(e?.clases.map((c) => c.claseAccion)).toEqual(['escritura', 'lectura']);
  });

  it('el historial muestra exactamente el cambio de nivel, con su fecha, versión, lección y persona (criterio 3)', async () => {
    const e = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    const cambios = e?.clases.flatMap((c) => c.historial) ?? [];
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({
      claseAccion: 'escritura',
      de: 'n1',
      a: 'n2',
      versionPuestoId: version3,
      numeroVersion: 3,
      leccionId,
      decididaPorPersonaId: personaId,
    });
    expect(new Date(cambios[0]?.fecha ?? '').getTime()).toBeLessThan(Date.now() - 9 * 86_400_000);
    expect(version2).not.toBe('');
  });

  it('una clase N1 fija no enseña avance; una N1 no fija cuenta acciones y decisiones del libro (criterio 4)', async () => {
    // Con la versión 2 activa, «escritura» está en N1.
    await conTenant(cliente, tenantId, async (tx) => {
      await tx`
        update puesto
        set ficha = '{"clasesFijas":["escritura"]}'::jsonb, version_activa_id = ${version2}
        where tenant_id = ${tenantId} and id = ${cobrosId}
      `;
    });
    const fija = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    expect(fija?.clases.find((c) => c.claseAccion === 'escritura')).toMatchObject({
      nivel: 'n1',
      ascenso: null,
      sinAscenso: 'fijo',
    });

    await conTenant(cliente, tenantId, async (tx) => {
      await tx`update puesto set ficha = '{}'::jsonb where tenant_id = ${tenantId} and id = ${cobrosId}`;
    });
    const e = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    const escritura = e?.clases.find((c) => c.claseAccion === 'escritura');
    expect(escritura?.ascenso).toMatchObject({
      de: 'n1',
      a: 'n2',
      acciones: { actual: 3, requerido: 30, cumplido: false },
      aprobadasSinCambiosPct: { requerido: 95, cumplido: false },
      diasSinIncidentes: { actual: 0, requerido: 30, cumplido: false },
      confirmacion: { confirmada: false },
      cumplidos: 0,
    });
    expect(escritura?.ascenso?.aprobadasSinCambiosPct.actual).toBeCloseTo(66.67, 1);

    await conTenant(cliente, tenantId, async (tx) => {
      await tx`
        update puesto set version_activa_id = ${version3}
        where tenant_id = ${tenantId} and id = ${cobrosId}
      `;
    });
    // Con la versión 3 activa, «escritura» está en N2 y ya no tiene ascenso definido.
    const n2 = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    expect(n2?.clases.find((c) => c.claseAccion === 'escritura')).toMatchObject({
      nivel: 'n2',
      ascenso: null,
      sinAscenso: 'sin_criterio',
    });
  });

  it('las acciones rechazadas por política son solo las del puesto y enlazan a la entrada del libro (criterio 5)', async () => {
    const e = await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    expect(e?.totalRechazadas).toBe(1);
    expect(e?.rechazadas).toHaveLength(1);
    expect(e?.rechazadas[0]).toMatchObject({
      claseAccion: 'comunicar',
      herramienta: 'enviar_tercer_aviso',
      nivel: 'n0',
      costeEuros: 0,
      tareaId: tareaDeRechazo,
      porque: 'La política del puesto exige permiso para esta clase.',
    });
    expect(e?.rechazadas[0]?.numeroOrden).toBeGreaterThan(0);
    expect(Date.parse(e?.rechazadas[0]?.creadoEn ?? '')).not.toBeNaN();
    // La del otro puesto de la misma organización y la de otra organización no se cuelan.
    const otro = await puertoExpediente(conexion.cliente).expediente(tenantId, conciliacionId);
    expect(otro?.rechazadas.map((r) => r.herramienta)).toEqual(['casar_apunte']);
  });

  it('otra organización recibe nulo con un puesto ajeno y no ve nada del nuestro (criterio 2)', async () => {
    const puerto = puertoExpediente(conexion.cliente);
    expect(await puerto.expediente(otroTenantId, cobrosId)).toBeNull();
    expect(await puerto.expediente(tenantId, otroCobrosId)).toBeNull();
    const suyo = await puerto.expediente(otroTenantId, otroCobrosId);
    expect(suyo?.rechazadas.map((r) => r.herramienta)).toEqual(['ajena']);
    expect(JSON.stringify(suyo)).not.toContain(version3);
  });

  it('un puesto inexistente da nulo; la lectura no escribe en el libro', async () => {
    const antes = await contarEntradas();
    expect(await puertoExpediente(conexion.cliente).expediente(tenantId, uuidV7())).toBeNull();
    await puertoExpediente(conexion.cliente).expediente(tenantId, cobrosId);
    expect(await contarEntradas()).toBe(antes);
  });

  async function contarEntradas(): Promise<number> {
    return conTenant(cliente, tenantId, async (tx) => {
      const [f] = await tx<{ n: number }[]>`
        select count(*)::int as n from entrada_auditoria where tenant_id = ${tenantId}
      `;
      return f?.n ?? 0;
    });
  }
});
