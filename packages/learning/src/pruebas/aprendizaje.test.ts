/**
 * Aprendizaje v0 contra PostgreSQL: edición → señal → lección → promoción manual →
 * versión nueva → reversión.
 *
 * Necesita base de datos: sin `DATABASE_URL` se salta diciendo por qué. Es donde se
 * comprueba lo que solo la base garantiza —filas inmutables, puntero de versión,
 * aislamiento por tenant y la cadena del libro— y los caminos de error de cada paso.
 */
import { aplicarMigraciones, conTenant, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import { ACCIONES, registrarDecision, solicitarAprobacion, verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCIONES_APRENDIZAJE,
  ErrorDeAprendizaje,
  leerExpediente,
  lineasDeMemoria,
  promocionarLeccion,
  proponerLeccion,
  registrarSenalDeEdicion,
  revertirVersion,
  versionActivaDe,
  type PuertaDeEvaluacion,
  type ResultadoDeLaPuerta,
} from '../index.js';

const TITULO = HAY_BASE_DE_DATOS ? 'aprendizaje v0' : `aprendizaje v0 — SALTADO. ${MOTIVO_SALTO}`;

/** Datos personales sembrados en la edición: no pueden aparecer en nada aprendido. */
const CORREO_CLIENTE = 'marta.garcia@cliente-demo.es';
const IBAN_CLIENTE = 'ES91 2100 0418 4502 0005 1332';

const ANTES = {
  conector: 'demo',
  argumentos: {
    factura: 'F-2026-0001',
    texto: 'Le recordamos que su factura F-2026-0001 está vencida.',
  },
};
const DESPUES = {
  conector: 'demo',
  argumentos: {
    factura: 'F-2026-0001',
    texto: `Te escribo para recordarte que tu factura F-2026-0001 está vencida. Si ya la pagaste a ${IBAN_CLIENTE}, escríbeme a ${CORREO_CLIENTE}.`,
  },
};

const CERTIFICA: PuertaDeEvaluacion = () => ({
  certificada: true,
  evaluador: 'prueba',
  casos: [{ id: 'caso-prueba', superado: true, puntuacion: 1, diagnostico: 'ok' }],
});

const BLOQUEA: PuertaDeEvaluacion = (): ResultadoDeLaPuerta => ({
  certificada: false,
  evaluador: 'prueba',
  casos: [{ id: 'caso-que-falla', superado: false, puntuacion: 0, diagnostico: 'empeora' }],
});

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let otra: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(8);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'aprendizaje');
    otra = await sembrarOrganizacion(cliente, 'aprendizaje-vecina');
  });

  afterAll(async () => {
    for (const sembrada of [org, otra]) {
      if (sembrada) await purgarOrganizacion(cliente, sembrada.tenantId);
    }
    await cliente.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  async function pedirAprobacion(tenant: OrganizacionSembrada): Promise<string> {
    const solicitada = await conTenant(cliente, tenant.tenantId, (tx) =>
      solicitarAprobacion(tx, tenant.tenantId, {
        tareaId: tenant.tareaId,
        personaId: tenant.personaId,
        claseAccion: 'comunicar',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'herramienta.redactar_nota', carga: ANTES },
        resumenLegible: 'Nota de seguimiento de F-2026-0001',
        venceEn: new Date(Date.now() + 86_400_000),
      }),
    );
    return solicitada.id;
  }

  async function editar(tenant: OrganizacionSembrada): Promise<string> {
    const aprobacionId = await pedirAprobacion(tenant);
    const decidida = await registrarDecision(cliente, tenant.tenantId, {
      aprobacionId,
      sentido: 'editada',
      edicionPrevia: { antes: ANTES, despues: DESPUES },
      origen: 'panel',
    });
    expect(decidida.estado).toBe('registrada');
    return aprobacionId;
  }

  async function acciones(tenantId: string): Promise<string[]> {
    const filas = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ accion: string }[]>`
        select accion from entrada_auditoria where tenant_id = ${tenantId} order by numero_orden
      `,
    );
    return filas.map((f) => f.accion);
  }

  async function esperarError(promesa: Promise<unknown>, codigo: string): Promise<void> {
    await expect(promesa).rejects.toBeInstanceOf(ErrorDeAprendizaje);
    await expect(promesa).rejects.toMatchObject({ codigo });
  }

  it('la decisión «editada» exige la edición y ninguna otra la admite', async () => {
    const aprobacionId = await pedirAprobacion(org);
    await expect(
      registrarDecision(cliente, org.tenantId, { aprobacionId, sentido: 'editada', origen: 'panel' }),
    ).rejects.toThrow(/necesita la edición/);
    await expect(
      registrarDecision(cliente, org.tenantId, {
        aprobacionId,
        sentido: 'aprobada',
        edicionPrevia: { antes: ANTES, despues: DESPUES },
        origen: 'panel',
      }),
    ).rejects.toThrow(/no lleva edición/);
    // Nada se escribió: la aprobación sigue pendiente y se puede aprobar sin editar.
    const aprobada = await registrarDecision(cliente, org.tenantId, {
      aprobacionId,
      sentido: 'aprobada',
      origen: 'panel',
    });
    expect(aprobada.estado).toBe('registrada');
    // Una aprobación sin edición no es una señal de edición.
    await esperarError(registrarSenalDeEdicion(cliente, org.tenantId, aprobacionId), 'no_es_edicion');
  });

  it('recorre edición, señal, lección, promoción, versión nueva y reversión', async () => {
    const versionInicial = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    const aprobacionId = await editar(org);
    expect(await acciones(org.tenantId)).toContain(ACCIONES.editada);

    // 1. Señal, idempotente por aprobación.
    const senal = await registrarSenalDeEdicion(cliente, org.tenantId, aprobacionId);
    expect(senal.nueva).toBe(true);
    const repetida = await registrarSenalDeEdicion(cliente, org.tenantId, aprobacionId);
    expect(repetida).toMatchObject({ senalId: senal.senalId, nueva: false });

    // 2. Lección de memoria, idempotente por señal y sin datos personales.
    const leccion = await proponerLeccion(cliente, org.tenantId, senal);
    expect(leccion.nueva).toBe(true);
    expect(leccion.linea).toContain('Te escribo para recordarte');
    expect(leccion.linea).not.toContain(CORREO_CLIENTE);
    expect(leccion.linea).not.toContain('2100 0418');
    expect((await proponerLeccion(cliente, org.tenantId, senal)).leccionId).toBe(leccion.leccionId);

    // 3. Sin persona no hay promoción; con una puerta que bloquea, tampoco hay versión.
    await esperarError(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId: leccion.leccionId,
        personaId: '',
        puerta: CERTIFICA,
      }),
      'sin_persona',
    );
    await esperarError(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId: leccion.leccionId,
        personaId: otra.personaId,
        puerta: CERTIFICA,
      }),
      'sin_persona',
    );
    const bloqueada = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: leccion.leccionId,
      personaId: org.personaId,
      puerta: BLOQUEA,
    });
    expect(bloqueada.estado).toBe('bloqueada');
    const trasBloqueo = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    expect(trasBloqueo).toEqual(versionInicial);

    // 4. Promoción manual certificada: versión nueva inmutable y puntero movido.
    const promocion = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: leccion.leccionId,
      personaId: org.personaId,
      puerta: CERTIFICA,
      motivo: 'Tuteamos a los clientes',
    });
    if (promocion.estado !== 'promocionada') throw new Error('Se esperaba la promoción.');
    expect(promocion.versionAnteriorId).toBe(versionInicial.versionPuestoId);
    expect(promocion.numero).toBe(3); // la semilla ya tiene las versiones 1 y 2
    await esperarError(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId: leccion.leccionId,
        personaId: org.personaId,
        puerta: CERTIFICA,
      }),
      'ya_promocionada',
    );

    // 5. La tarea siguiente arranca con la versión nueva y su memoria tiene la lección.
    const siguiente = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    expect(siguiente.versionPuestoId).toBe(promocion.versionPuestoId);
    const [nueva] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ memoria_congelada: unknown; prompt: string; resultados_eval: unknown }[]>`
        select memoria_congelada, prompt, resultados_eval from version_puesto
        where tenant_id = ${org.tenantId} and id = ${promocion.versionPuestoId}
      `,
    );
    expect(lineasDeMemoria(nueva?.memoria_congelada)).toEqual([leccion.linea]);
    expect(nueva?.prompt).toBe('Eres el contable.');
    expect(nueva?.resultados_eval).toMatchObject({ certificada: true });

    // La versión es inmutable: ni siquiera el dueño del esquema la actualiza.
    await expect(
      conTenant(
        cliente,
        org.tenantId,
        (tx) => tx`update version_puesto set prompt = 'otro' where id = ${promocion.versionPuestoId}`,
      ),
    ).rejects.toThrow(/inmutable/);

    // 6. Reversión: caminos de error y vuelta a la versión inicial.
    await esperarError(
      revertirVersion(cliente, org.tenantId, {
        puestoId: org.puestoId,
        aVersionId: promocion.versionPuestoId,
        personaId: org.personaId,
      }),
      'ya_activa',
    );
    await esperarError(
      revertirVersion(cliente, org.tenantId, {
        puestoId: org.puestoId,
        aVersionId: otra.versionPuestoId,
        personaId: org.personaId,
      }),
      'version_ajena',
    );
    const revertida = await revertirVersion(cliente, org.tenantId, {
      puestoId: org.puestoId,
      aVersionId: versionInicial.versionPuestoId,
      personaId: org.personaId,
      motivo: 'Demasiado informal para este cliente',
    });
    expect(revertida).toMatchObject({
      desdeVersionId: promocion.versionPuestoId,
      aVersionId: versionInicial.versionPuestoId,
      retiradas: [leccion.leccionId],
      repuestas: [],
    });
    const trasRevertir = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    expect(trasRevertir).toEqual(versionInicial);

    const [memoriaViva] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ caduca_en: Date | null }[]>`
        select caduca_en from memoria
        where tenant_id = ${org.tenantId} and clave = ${`leccion:${leccion.leccionId}`}
      `,
    );
    expect(memoriaViva?.caduca_en).not.toBeNull();

    const expediente = await leerExpediente(cliente, org.tenantId, org.puestoId);
    expect(expediente.lecciones.find((l) => l.leccionId === leccion.leccionId)?.estado).toBe(
      'retirada',
    );

    // Volver hacia delante repone la lección.
    const adelante = await revertirVersion(cliente, org.tenantId, {
      puestoId: org.puestoId,
      aVersionId: promocion.versionPuestoId,
      personaId: org.personaId,
    });
    expect(adelante.repuestas).toEqual([leccion.leccionId]);

    // 7. Cada paso está en el libro, la cadena verifica y el contador sumó.
    const anotadas = await acciones(org.tenantId);
    for (const accion of Object.values(ACCIONES_APRENDIZAJE)) {
      expect(anotadas).toContain(accion);
    }
    const verificacion = await conTenant(cliente, org.tenantId, (tx) =>
      verificarCadenaEnBase(tx, org.tenantId),
    );
    expect(verificacion.valida).toBe(true);
    const [contador] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ acciones: string }[]>`
        select sum(acciones)::text as acciones from contador_consumo where tenant_id = ${org.tenantId}
      `,
    );
    expect(Number(contador?.acciones)).toBe(anotadas.length);
  });

  it('otra organización no ve ni aprende de una edición ajena', async () => {
    const aprobacionId = await editar(org);
    await esperarError(registrarSenalDeEdicion(cliente, otra.tenantId, aprobacionId), 'no_es_edicion');
    const senal = await registrarSenalDeEdicion(cliente, org.tenantId, aprobacionId);
    await esperarError(proponerLeccion(cliente, otra.tenantId, senal), 'no_encontrada');
  });

  it('ningún dato personal de la edición llega a lo aprendido ni al libro', async () => {
    const volcado = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ texto: string }[]>`
        select concat_ws(' ',
          (select string_agg(contenido::text, ' ') from senal where tenant_id = ${org.tenantId}),
          (select string_agg(contenido::text || parametros::text || titulo, ' ') from leccion
            where tenant_id = ${org.tenantId}),
          (select string_agg(memoria_congelada::text || lecciones_origen::text, ' ') from version_puesto
            where tenant_id = ${org.tenantId}),
          (select string_agg(contenido, ' ') from memoria where tenant_id = ${org.tenantId}),
          (select string_agg(datos_referenciados::text, ' ') from entrada_auditoria
            where tenant_id = ${org.tenantId})
        ) as texto
      `,
    );
    const texto = volcado[0]?.texto ?? '';
    expect(texto).toContain('Te escribo para recordarte');
    expect(texto).not.toContain(CORREO_CLIENTE);
    expect(texto).not.toContain(IBAN_CLIENTE);
    expect(texto).not.toContain('2100 0418');
  });
});
