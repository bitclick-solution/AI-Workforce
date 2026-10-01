/**
 * Aprobaciones, decisiones y exportación contra PostgreSQL.
 *
 * Necesita base de datos: sin `DATABASE_URL` estas pruebas se saltan. Es donde se
 * comprueba lo que solo la base puede garantizar —una decisión por aprobación, el
 * aislamiento por tenant y el encadenado del libro— y lo que la especificación pide
 * como criterio de seguridad: enlace reutilizado, vencido y de otro tenant.
 */
import { aplicarMigraciones, conTenant, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCIONES,
  DESTINO_EVENTO_APROBACION_CORREO,
  TIPO_EVENTO_APROBACION_CREADA,
  anotarCorreoEnviado,
  anotarEnlaceAbierto,
  anotarEnlaceRechazado,
  cargaDeSenal,
  leerAprobacion,
  registrarDecision,
  solicitarAprobacion,
  vencerAprobaciones,
  type AprobacionLeida,
} from '../aprobacion.js';
import { exportarLibro } from '../exportar.js';
import { verificarCadenaEnBase } from '../libro.js';
import { eventosPendientes, marcarEventoFallido, marcarEventoPublicado } from '../salida.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'aprobaciones y exportación'
  : `aprobaciones y exportación — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let otra: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(8);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'aprobacion');
    otra = await sembrarOrganizacion(cliente, 'aprobacion-vecina');
  });

  afterAll(async () => {
    for (const sembrada of [org, otra]) {
      if (sembrada) await purgarOrganizacion(cliente, sembrada.tenantId);
    }
    // El libro no se borra fila a fila ni en las pruebas: lo impide el disparador.
    await cliente.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  /** Crea una aprobación nueva con `solicitarAprobacion`, que es el camino real. */
  async function pedirPermiso(opciones: { venceEn?: Date | null; resumen?: string } = {}) {
    return conTenant(cliente, org.tenantId, (tx) =>
      solicitarAprobacion(tx, org.tenantId, {
        tareaId: org.tareaId,
        pasoId: org.pasoId,
        personaId: org.personaId,
        claseAccion: 'pago.emitir',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'pago', carga: { opaco: true } },
        resumenLegible: opciones.resumen ?? 'Pagar 1.200 € a Suministros Pérez',
        venceEn:
          opciones.venceEn === undefined ? new Date(Date.now() + 86_400_000) : opciones.venceEn,
      }),
    );
  }

  async function leer(tenantId: string, aprobacionId: string): Promise<AprobacionLeida | null> {
    return conTenant(cliente, tenantId, (tx) => leerAprobacion(tx, tenantId, aprobacionId));
  }

  async function accionesDelLibro(tenantId: string, aprobacionId: string): Promise<string[]> {
    return conTenant(cliente, tenantId, async (tx) => {
      const filas = await tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${tenantId}
          and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: aprobacionId }])}::text::jsonb
        order by numero_orden asc
      `;
      return filas.map((fila) => fila.accion);
    });
  }

  describe('decidir editada', () => {
    it('guarda la carga de antes y la de después, y la anota como edición', async () => {
      const pedida = await pedirPermiso();
      const edicion = { antes: { importe: 1200 }, despues: { importe: 1150 } };
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'editada',
        edicionPrevia: edicion,
        origen: 'panel',
      });
      expect(resultado.estado).toBe('registrada');
      const [fila] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ edicion_previa: unknown }[]>`
          select edicion_previa from decision_aprobacion
          where tenant_id = ${org.tenantId} and aprobacion_id = ${pedida.id}
        `,
      );
      expect(fila?.edicion_previa).toEqual(edicion);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.editada,
      ]);
    });

    it('sin edición, o con edición y otro sentido, no escribe nada', async () => {
      const pedida = await pedirPermiso();
      await expect(
        registrarDecision(cliente, org.tenantId, {
          aprobacionId: pedida.id,
          sentido: 'editada',
          origen: 'panel',
        }),
      ).rejects.toThrow(/necesita la edición/);
      await expect(
        registrarDecision(cliente, org.tenantId, {
          aprobacionId: pedida.id,
          sentido: 'rechazada',
          edicionPrevia: { antes: 1, despues: 2 },
          origen: 'panel',
        }),
      ).rejects.toThrow(/no lleva edición/);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([ACCIONES.solicitada]);
      expect((await leer(org.tenantId, pedida.id))?.decision).toBeNull();
    });
  });

  describe('solicitar', () => {
    it('inserta la aprobación y la anota en el mismo movimiento', async () => {
      const pedida = await pedirPermiso();
      expect(pedida.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(pedida.entrada.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([ACCIONES.solicitada]);
    });

    it('la aprobación recién pedida no tiene decisión: es lo que la hace pendiente', async () => {
      const pedida = await pedirPermiso();
      expect((await leer(org.tenantId, pedida.id))?.decision).toBeNull();
    });

    it('rechaza una aprobación sin resumen legible antes de tocar la base', async () => {
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          solicitarAprobacion(tx, org.tenantId, {
            tareaId: org.tareaId,
            claseAccion: 'pago.emitir',
            nivelExigido: 'n1',
            borradorOpaco: { tipo: 'pago', carga: {} },
            resumenLegible: '   ',
          }),
        ),
      ).rejects.toThrow(/resumen legible/);
    });

    it('rechaza un borrador que no cumple su esquema', async () => {
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          solicitarAprobacion(tx, org.tenantId, {
            tareaId: org.tareaId,
            claseAccion: 'pago.emitir',
            nivelExigido: 'n1',
            // Sin `tipo`: el esquema del borrador opaco lo exige.
            borradorOpaco: { carga: {} } as never,
            resumenLegible: 'Algo',
          }),
        ),
      ).rejects.toThrow(/borrador_opaco/);
    });

    it('no deja pedir permiso sobre una tarea de otro tenant', async () => {
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          solicitarAprobacion(tx, org.tenantId, {
            tareaId: otra.tareaId,
            claseAccion: 'pago.emitir',
            nivelExigido: 'n1',
            borradorOpaco: { tipo: 'pago', carga: {} },
            resumenLegible: 'Pago cruzado',
          }),
        ),
      ).rejects.toThrow(/no existe en este tenant/);
    });

    it('deja un evento pendiente en la salida transaccional, para que apps/channels mande el correo solo', async () => {
      const pedida = await pedirPermiso();

      const pendientes = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO),
      );
      const delEvento = pendientes.find(
        (evento) =>
          typeof evento.carga === 'object' &&
          evento.carga !== null &&
          (evento.carga as { aprobacionId?: unknown }).aprobacionId === pedida.id,
      );
      expect(delEvento).toMatchObject({
        tipo: TIPO_EVENTO_APROBACION_CREADA,
        carga: { version: 1, aprobacionId: pedida.id },
        intentos: 0,
      });
    });

    it('un borrador que no cumple su esquema no deja ni aprobación ni evento (misma transacción)', async () => {
      const antes = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
      );
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          solicitarAprobacion(tx, org.tenantId, {
            tareaId: org.tareaId,
            claseAccion: 'pago.emitir',
            nivelExigido: 'n1',
            borradorOpaco: { carga: {} } as never,
            resumenLegible: 'Algo',
          }),
        ),
      ).rejects.toThrow();
      const despues = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
      );
      expect(despues).toHaveLength(antes.length);
    });
  });

  describe('salida transaccional de eventos', () => {
    it('marcarEventoPublicado lo saca de los pendientes', async () => {
      await pedirPermiso();
      const [evento] = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1),
      );
      if (!evento) throw new Error('Esperaba un evento pendiente.');
      await conTenant(cliente, org.tenantId, (tx) =>
        marcarEventoPublicado(tx, org.tenantId, evento.id),
      );
      const pendientes = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
      );
      expect(pendientes.some((e) => e.id === evento.id)).toBe(false);
    });

    it('marcarEventoFallido lo saca de los pendientes también: no se reintenta solo', async () => {
      await pedirPermiso();
      const [evento] = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1),
      );
      if (!evento) throw new Error('Esperaba un evento pendiente.');
      await conTenant(cliente, org.tenantId, (tx) =>
        marcarEventoFallido(tx, org.tenantId, evento.id, 'SMTP caído'),
      );
      const pendientes = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
      );
      expect(pendientes.some((e) => e.id === evento.id)).toBe(false);
    });

    it('los eventos de un tenant no se ven desde otro', async () => {
      const pedida = await conTenant(cliente, otra.tenantId, (tx) =>
        solicitarAprobacion(tx, otra.tenantId, {
          tareaId: otra.tareaId,
          claseAccion: 'pago.emitir',
          nivelExigido: 'n1',
          borradorOpaco: { tipo: 'pago', carga: { opaco: true } },
          resumenLegible: 'Pago de la organización vecina',
          venceEn: new Date(Date.now() + 86_400_000),
        }),
      );
      const vistoDesdeOrg = await conTenant(cliente, org.tenantId, (tx) =>
        eventosPendientes(tx, org.tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
      );
      expect(
        vistoDesdeOrg.some(
          (evento) =>
            typeof evento.carga === 'object' &&
            evento.carga !== null &&
            (evento.carga as { aprobacionId?: unknown }).aprobacionId === pedida.id,
        ),
      ).toBe(false);
    });
  });

  describe('decidir', () => {
    it('registra la decisión y la anota con el sentido en el nombre de la acción', async () => {
      const pedida = await pedirPermiso();
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
        herramienta: 'correo',
      });

      expect(resultado.estado).toBe('registrada');
      if (resultado.estado !== 'registrada') return;
      expect(resultado.decision.personaId).toBe(org.personaId);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.aprobada,
      ]);
    });

    it('un rechazo es una acción con éxito: el resultado habla de la plataforma', async () => {
      const pedida = await pedirPermiso();
      await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'rechazada',
        origen: 'correo',
      });
      const [entrada] = await conTenant(cliente, org.tenantId, async (tx) => {
        return tx<{ resultado: string; aprobada_por_persona_id: string | null }[]>`
          select resultado, aprobada_por_persona_id from entrada_auditoria
          where tenant_id = ${org.tenantId} and accion = ${ACCIONES.rechazada}
            and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: pedida.id }])}::text::jsonb
        `;
      });
      expect(entrada?.resultado).toBe('exito');
      // Nadie autorizó nada: la columna que habla de aprobar queda vacía.
      expect(entrada?.aprobada_por_persona_id).toBeNull();
    });

    it('el mismo enlace usado dos veces solo registra una decisión', async () => {
      const pedida = await pedirPermiso();
      const primera = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });
      const segunda = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'rechazada',
        origen: 'correo',
      });

      expect(primera.estado).toBe('registrada');
      expect(segunda.estado).toBe('rechazada_por_enlace');
      if (segunda.estado !== 'rechazada_por_enlace') return;
      expect(segunda.motivo).toBe('ya_decidida');
      // El sentido que queda es el de la primera, no el del segundo clic.
      expect(segunda.decisionPrevia?.sentido).toBe('aprobada');
      expect(await contarDecisiones(pedida.id)).toBe(1);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.aprobada,
        ACCIONES.enlaceRechazado,
      ]);
    });

    it('dos clics a la vez: una sola decisión y un solo sentido', async () => {
      const pedida = await pedirPermiso();
      const [uno, dos] = await Promise.all([
        registrarDecision(cliente, org.tenantId, {
          aprobacionId: pedida.id,
          sentido: 'aprobada',
          origen: 'correo',
        }),
        registrarDecision(cliente, org.tenantId, {
          aprobacionId: pedida.id,
          sentido: 'rechazada',
          origen: 'correo',
        }),
      ]);

      const estados = [uno.estado, dos.estado].sort();
      expect(estados).toEqual(['rechazada_por_enlace', 'registrada']);
      expect(await contarDecisiones(pedida.id)).toBe(1);
    });

    it('la aprobación vencida no se decide, y el intento queda anotado', async () => {
      const pedida = await pedirPermiso({ venceEn: new Date(Date.now() - 60_000) });
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });

      expect(resultado.estado).toBe('rechazada_por_enlace');
      if (resultado.estado !== 'rechazada_por_enlace') return;
      expect(resultado.motivo).toBe('vencida');
      expect(await contarDecisiones(pedida.id)).toBe(0);
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.enlaceRechazado,
      ]);
    });

    it('sin vencimiento la aprobación no caduca por sí sola', async () => {
      const pedida = await pedirPermiso({ venceEn: null });
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });
      expect(resultado.estado).toBe('registrada');
    });

    it('una aprobación que no existe no escribe decisión, pero sí deja rastro', async () => {
      const inventada = '01920000-0000-7000-8000-00000000dead';
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: inventada,
        tareaId: org.tareaId,
        sentido: 'aprobada',
        origen: 'correo',
      });
      expect(resultado.estado).toBe('rechazada_por_enlace');
      if (resultado.estado !== 'rechazada_por_enlace') return;
      expect(resultado.motivo).toBe('no_encontrada');
      expect(await accionesDelLibro(org.tenantId, inventada)).toEqual([ACCIONES.enlaceRechazado]);
    });

    it('un identificador que no es UUID se trata como aprobación inexistente', async () => {
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: 'no-soy-un-uuid',
        tareaId: org.tareaId,
        sentido: 'aprobada',
        origen: 'correo',
      });
      expect(resultado.estado).toBe('rechazada_por_enlace');
    });

    it('la aprobación de otro tenant no se ve ni se decide', async () => {
      const ajena = await conTenant(cliente, otra.tenantId, (tx) =>
        solicitarAprobacion(tx, otra.tenantId, {
          tareaId: otra.tareaId,
          personaId: otra.personaId,
          claseAccion: 'pago.emitir',
          nivelExigido: 'n1',
          borradorOpaco: { tipo: 'pago', carga: {} },
          resumenLegible: 'Pago de la organización vecina',
        }),
      );

      // Un token firmado para el tenant de `org` que apunta a una aprobación de
      // `otra`: la firma sería válida y la RLS es lo único que lo para.
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: ajena.id,
        tareaId: org.tareaId,
        sentido: 'aprobada',
        origen: 'correo',
      });

      expect(resultado.estado).toBe('rechazada_por_enlace');
      if (resultado.estado !== 'rechazada_por_enlace') return;
      expect(resultado.motivo).toBe('no_encontrada');
      expect(await contarDecisiones(ajena.id, otra.tenantId)).toBe(0);
      // El intento se anota en la cadena del tenant del token, no en la del vecino.
      expect(await accionesDelLibro(org.tenantId, ajena.id)).toEqual([ACCIONES.enlaceRechazado]);
      expect(await accionesDelLibro(otra.tenantId, ajena.id)).toEqual([ACCIONES.solicitada]);
    });
  });

  describe('vencer', () => {
    it('resuelve la vencida sin decisión en nombre de la plataforma', async () => {
      const pedida = await pedirPermiso({ venceEn: new Date(Date.now() - 120_000) });
      const vencidas = await vencerAprobaciones(cliente, org.tenantId);
      const mia = vencidas.find((v) => v.aprobacion.id === pedida.id);

      expect(mia).toBeDefined();
      expect(mia?.decision.sentido).toBe('rechazada');
      // `persona_id` nulo es lo que el modelo reserva para «la resolvió la plataforma».
      expect(mia?.decision.personaId).toBeNull();
      expect(mia?.carga.origen).toBe('plataforma');
      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.vencida,
      ]);
    });

    it('es idempotente: la segunda pasada no vuelve a resolver nada', async () => {
      await pedirPermiso({ venceEn: new Date(Date.now() - 120_000) });
      const primera = await vencerAprobaciones(cliente, org.tenantId);
      const segunda = await vencerAprobaciones(cliente, org.tenantId);
      expect(primera.length).toBeGreaterThan(0);
      expect(segunda).toHaveLength(0);
    });

    it('no toca la que ya tiene decisión ni la que no ha vencido', async () => {
      const viva = await pedirPermiso();
      const decidida = await pedirPermiso({ venceEn: new Date(Date.now() - 120_000) });
      await registrarDecision(cliente, org.tenantId, {
        aprobacionId: decidida.id,
        sentido: 'aprobada',
        origen: 'panel',
        ahora: new Date(Date.now() - 200_000),
      });

      const vencidas = await vencerAprobaciones(cliente, org.tenantId);
      expect(vencidas.map((v) => v.aprobacion.id)).not.toContain(viva.id);
      expect(vencidas.map((v) => v.aprobacion.id)).not.toContain(decidida.id);
    });

    it('respeta el límite por pasada', async () => {
      await pedirPermiso({ venceEn: new Date(Date.now() - 120_000) });
      await pedirPermiso({ venceEn: new Date(Date.now() - 130_000) });
      expect(await vencerAprobaciones(cliente, org.tenantId, { limite: 1 })).toHaveLength(1);
    });

    it('con identificador vence solo esa aprobación y deja las demás a la rutina', async () => {
      const mia = await pedirPermiso({ venceEn: new Date(Date.now() - 120_000) });
      const ajena = await pedirPermiso({ venceEn: new Date(Date.now() - 130_000) });

      const vencidas = await vencerAprobaciones(cliente, org.tenantId, {
        aprobacionId: mia.id,
        motivo: 'Vencida sin respuesta durante la ejecución del flujo',
      });
      expect(vencidas.map((v) => v.aprobacion.id)).toEqual([mia.id]);
      expect(vencidas[0]?.carga.motivo).toBe(
        'Vencida sin respuesta durante la ejecución del flujo',
      );

      const ajenaLeida = await leer(org.tenantId, ajena.id);
      expect(ajenaLeida?.decision).toBeNull();
    });
  });

  describe('anotaciones del canal', () => {
    it('el envío anota un intento por vez, con su resultado', async () => {
      const pedida = await pedirPermiso();
      const aprobacion = (await leer(org.tenantId, pedida.id)) as AprobacionLeida;

      await anotarCorreoEnviado(cliente, org.tenantId, {
        aprobacion,
        intento: 1,
        proveedor: 'smtp',
        duracionMs: 30,
        error: 'Error: SMTP no responde',
      });
      await anotarCorreoEnviado(cliente, org.tenantId, {
        aprobacion,
        intento: 2,
        proveedor: 'smtp',
        duracionMs: 70,
        referencia: 'mensaje-1',
      });

      const resultados = await conTenant(cliente, org.tenantId, async (tx) => {
        const filas = await tx<{ resultado: string; duracion_ms: number }[]>`
          select resultado, duracion_ms from entrada_auditoria
          where tenant_id = ${org.tenantId} and accion = ${ACCIONES.correoEnviado}
            and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: pedida.id }])}::text::jsonb
          order by numero_orden asc
        `;
        return filas;
      });
      expect(resultados.map((r) => r.resultado)).toEqual(['error', 'exito']);
      expect(resultados[1]?.duracion_ms).toBe(70);
    });

    it('la apertura del enlace se anota y no decide nada', async () => {
      const pedida = await pedirPermiso();
      const aprobacion = (await leer(org.tenantId, pedida.id)) as AprobacionLeida;
      await anotarEnlaceAbierto(cliente, org.tenantId, aprobacion);

      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.enlaceAbierto,
      ]);
      expect(await contarDecisiones(pedida.id)).toBe(0);
    });

    it('el rechazo de enlace se puede anotar sin haber podido leer la aprobación', async () => {
      const anotada = await anotarEnlaceRechazado(cliente, org.tenantId, {
        aprobacionId: '01920000-0000-7000-8000-0000000000ff',
        motivo: 'no_encontrada',
        origen: 'correo',
      });
      expect(anotada.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('la carga de la señal lleva identificadores y nunca el borrador', async () => {
      const pedida = await pedirPermiso();
      const resultado = await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });
      if (resultado.estado !== 'registrada') throw new Error('no se registró la decisión');

      const carga = cargaDeSenal(org.tenantId, resultado.aprobacion, resultado.decision, 'correo');
      expect(carga).toMatchObject({
        tenantId: org.tenantId,
        aprobacionId: pedida.id,
        tareaId: org.tareaId,
        sentido: 'aprobada',
        origen: 'correo',
        personaId: org.personaId,
      });
      expect(JSON.stringify(carga)).not.toContain('borrador');
      expect(JSON.stringify(carga)).not.toContain('opaco');
    });
  });

  describe('la cadena y el contador después de todo el camino', () => {
    it('la cadena del tenant sigue verificando y el contador cuadra', async () => {
      const antes = await accionesDelContador(org.tenantId);
      const pedida = await pedirPermiso();
      const aprobacion = (await leer(org.tenantId, pedida.id)) as AprobacionLeida;
      await anotarCorreoEnviado(cliente, org.tenantId, {
        aprobacion,
        intento: 1,
        proveedor: 'memoria',
        duracionMs: 1,
        referencia: 'memoria-1',
      });
      await anotarEnlaceAbierto(cliente, org.tenantId, aprobacion);
      await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });

      expect(await accionesDelLibro(org.tenantId, pedida.id)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
        ACCIONES.enlaceAbierto,
        ACCIONES.aprobada,
      ]);
      const verificacion = await conTenant(cliente, org.tenantId, (tx) =>
        verificarCadenaEnBase(tx, org.tenantId),
      );
      expect(verificacion.valida).toBe(true);
      // Cuatro acciones, cuatro unidades en el contador: una por entrada, sin excepción.
      expect((await accionesDelContador(org.tenantId)) - antes).toBe(4);
    });
  });

  describe('exportación', () => {
    it('exporta en CSV, JSON y JSON por líneas con el veredicto en la cabecera', async () => {
      const pedida = await pedirPermiso({ resumen: 'Exportar esto' });
      await registrarDecision(cliente, org.tenantId, {
        aprobacionId: pedida.id,
        sentido: 'aprobada',
        origen: 'correo',
      });

      const csv = await exportarLibro(cliente, { tenantId: org.tenantId, formato: 'csv' });
      expect(csv.cabecera.verificacion.valida).toBe(true);
      expect(csv.cabecera.verificacion.anclada).toBe(true);
      expect(csv.contenido.split('\n')[0]).toContain('numero_orden,creado_en');
      expect(csv.contenido).toContain(ACCIONES.aprobada);

      const json = await exportarLibro(cliente, { tenantId: org.tenantId, formato: 'json' });
      const documento = JSON.parse(json.contenido) as { entradas: { accion: string }[] };
      expect(documento.entradas.length).toBe(json.cabecera.entradas);

      const jsonl = await exportarLibro(cliente, { tenantId: org.tenantId, formato: 'jsonl' });
      expect(jsonl.contenido.trimEnd().split('\n')).toHaveLength(jsonl.cabecera.entradas + 1);
    });

    it('el rango recorta por fechas y sigue verificando anclado en la anterior', async () => {
      const corte = new Date();
      await pedirPermiso({ resumen: 'Después del corte' });

      const despues = await exportarLibro(cliente, {
        tenantId: org.tenantId,
        formato: 'json',
        desde: corte,
      });
      expect(despues.cabecera.entradas).toBeGreaterThan(0);
      expect(despues.cabecera.primerNumeroOrden).toBeGreaterThan(1);
      expect(despues.cabecera.verificacion.valida).toBe(true);
      expect(despues.cabecera.verificacion.anclada).toBe(true);

      const antes = await exportarLibro(cliente, {
        tenantId: org.tenantId,
        formato: 'json',
        hasta: corte,
      });
      expect(antes.cabecera.primerNumeroOrden).toBe(1);
      expect(antes.cabecera.entradas + despues.cabecera.entradas).toBeGreaterThan(0);
    });

    it('un rango sin entradas exporta vacío y válido', async () => {
      const exportado = await exportarLibro(cliente, {
        tenantId: org.tenantId,
        formato: 'csv',
        desde: new Date(Date.UTC(2030, 0, 1)),
      });
      expect(exportado.cabecera.entradas).toBe(0);
      expect(exportado.cabecera.verificacion.valida).toBe(true);
      expect(exportado.contenido.trimEnd().split('\n')).toHaveLength(1);
    });

    it('el tenant vecino no ve las entradas del otro', async () => {
      const mio = await exportarLibro(cliente, { tenantId: org.tenantId, formato: 'jsonl' });
      const vecino = await exportarLibro(cliente, { tenantId: otra.tenantId, formato: 'jsonl' });
      expect(vecino.contenido).not.toContain(mio.filas[0]?.hash ?? 'imposible');
    });

    it('con una entrada alterada no exporta, y con permiso explícito exporta y lo dice', async () => {
      const pedida = await pedirPermiso({ resumen: 'La que se va a alterar' });
      const numeroOrden = await alterarEntrada(pedida.id);

      await expect(
        exportarLibro(cliente, { tenantId: org.tenantId, formato: 'json' }),
      ).rejects.toThrow(/no verifica/);

      const forzada = await exportarLibro(cliente, {
        tenantId: org.tenantId,
        formato: 'json',
        exigirCadenaValida: false,
      });
      expect(forzada.cabecera.verificacion.valida).toBe(false);
      expect(forzada.cabecera.verificacion.rotaEn).toBe(numeroOrden);
      expect(forzada.cabecera.verificacion.motivo).toContain('alterada');
      expect(forzada.filas.length).toBeGreaterThan(0);
    });
  });

  async function contarDecisiones(aprobacionId: string, tenantId = org.tenantId): Promise<number> {
    return conTenant(cliente, tenantId, async (tx) => {
      const [fila] = await tx<{ total: string }[]>`
        select count(*) as total from decision_aprobacion
        where tenant_id = ${tenantId} and aprobacion_id = ${aprobacionId}
      `;
      return Number(fila?.total ?? 0);
    });
  }

  async function accionesDelContador(tenantId: string): Promise<number> {
    return conTenant(cliente, tenantId, async (tx) => {
      const [fila] = await tx<{ acciones: string }[]>`
        select coalesce(sum(acciones), 0) as acciones from contador_consumo
        where tenant_id = ${tenantId}
      `;
      return Number(fila?.acciones ?? 0);
    });
  }

  /**
   * Altera una entrada del libro como lo haría quien tiene acceso a la base.
   *
   * Hace falta quitar el disparador de append-only y asumir el rol dueño del
   * esquema: exactamente el trabajo que tendría que hacer un atacante, y la razón
   * de que el hash encadenado exista. La entrada se deja alterada a propósito: es
   * la última prueba del bloque.
   */
  async function alterarEntrada(aprobacionId: string): Promise<number> {
    return cliente.begin(async (tx) => {
      await tx.unsafe('set local role aiw_migrador');
      await tx`select set_config('aiw.tenant_id', ${org.tenantId}, true)`;
      await tx.unsafe(
        'alter table entrada_auditoria disable trigger entrada_auditoria_sin_actualizar',
      );
      const [fila] = await tx<{ numero_orden: string }[]>`
        update entrada_auditoria
        set accion = 'aprobacion.inventada'
        where tenant_id = ${org.tenantId}
          and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: aprobacionId }])}::text::jsonb
        returning numero_orden
      `;
      await tx.unsafe(
        'alter table entrada_auditoria enable trigger entrada_auditoria_sin_actualizar',
      );
      return Number(fila?.numero_orden ?? 0);
    }) as Promise<number>;
  }
});
