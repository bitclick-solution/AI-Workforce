/**
 * El camino completo: pedir, enviar, abrir, decidir, señalar y vencer.
 *
 * Contra PostgreSQL de verdad, porque lo que se comprueba aquí es lo que solo la
 * base garantiza. Sin `DATABASE_URL` se salta con el mensaje de `@aiw/db/pruebas`.
 *
 * El correo y la señal son los puertos en memoria: en este entorno no hay servidor
 * de correo ni de Temporal, y capturar lo que sale es además la única forma de
 * comprobar que sale lo que tiene que salir.
 */
import { randomBytes } from 'node:crypto';

import { aplicarMigraciones, conTenant, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import { ACCIONES, solicitarAprobacion } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CorreoEnMemoria } from '../correo/memoria.js';
import { SenalEnMemoria } from '../senal/memoria.js';
import { Secreto } from '../secreto.js';
import { firmarEnlace } from '../aprobacion/firma.js';
import { leerConfiguracion, type ConfiguracionAprobacion } from '../aprobacion/configuracion.js';
import { ErrorBanderaApagada, ServicioDeAprobacion } from '../aprobacion/servicio.js';
import { arrancarServidor, enrutar } from '../aprobacion/servidor.js';

import { CorreoQueFalla, SenalQueFalla, sinDormir } from './dobles.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'aprobación por correo, camino completo'
  : `aprobación por correo — SALTADO. ${MOTIVO_SALTO}`;

const CLAVE = randomBytes(32).toString('hex');

function configuracion(extra: Record<string, string> = {}): ConfiguracionAprobacion {
  return leerConfiguracion({
    AIW_APROBACION_CORREO: '1',
    AIW_APROBACION_CLAVE_FIRMA: CLAVE,
    AIW_APROBACION_URL_PUBLICA: 'https://aiw.example',
    AIW_CORREO_RETARDO_MS: '1',
    AIW_SENAL_RETARDO_MS: '1',
    ...extra,
  });
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let otra: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(8);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'canal-aprobacion');
    otra = await sembrarOrganizacion(cliente, 'canal-vecino');
  });

  afterAll(async () => {
    for (const sembrada of [org, otra]) {
      if (sembrada) await purgarOrganizacion(cliente, sembrada.tenantId);
    }
    await cliente.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  interface Montaje {
    servicio: ServicioDeAprobacion;
    correo: CorreoEnMemoria;
    senal: SenalEnMemoria;
  }

  function montar(ahora?: () => Date, extra: Record<string, string> = {}): Montaje {
    const correo = new CorreoEnMemoria();
    const senal = new SenalEnMemoria();
    const servicio = new ServicioDeAprobacion({
      cliente,
      configuracion: configuracion(extra),
      correo,
      senal,
      dormir: sinDormir,
      ...(ahora ? { ahora } : {}),
    });
    return { servicio, correo, senal };
  }

  async function pedirPermiso(
    tenant: OrganizacionSembrada = org,
    venceEn: Date | null = new Date(Date.now() + 86_400_000),
  ): Promise<string> {
    const pedida = await conTenant(cliente, tenant.tenantId, (tx) =>
      solicitarAprobacion(tx, tenant.tenantId, {
        tareaId: tenant.tareaId,
        pasoId: tenant.pasoId,
        personaId: tenant.personaId,
        claseAccion: 'pago.emitir',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'pago', carga: { iban: 'oculto', importe: 1200 } },
        resumenLegible: 'Pagar 1.200 € a Suministros Pérez <script>no</script>',
        venceEn,
      }),
    );
    return pedida.id;
  }

  async function acciones(tenantId: string, aprobacionId: string): Promise<string[]> {
    return conTenant(cliente, tenantId, async (tx) => {
      const filas = await tx<{ accion: string }[]>`
        select accion from entrada_auditoria
        where tenant_id = ${tenantId}
          and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: aprobacionId }])}::text::jsonb
        order by numero_orden asc
      `;
      return filas.map((f) => f.accion);
    });
  }

  describe('enviar la solicitud', () => {
    it('firma el enlace, compone el correo y anota el envío', async () => {
      const { servicio, correo } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);

      expect(enviada.intentos).toBe(1);
      expect(enviada.url).toContain('https://aiw.example/aprobaciones/');
      expect(enviada.url).toContain(enviada.token);
      expect(correo.enviados).toHaveLength(1);
      // El destinatario sale de la ficha de la persona a la que se le pide.
      expect(correo.ultimo?.para).toContain('@');
      expect(correo.ultimo?.texto).toContain('Pagar 1.200 €');
      // El borrador opaco no viaja en el correo, ni en texto ni en HTML.
      expect(correo.ultimo?.texto).not.toContain('iban');
      expect(correo.ultimo?.html).not.toContain('iban');
      expect(await acciones(org.tenantId, aprobacionId)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
      ]);
    });

    it('el enlace no caduca después de la aprobación', async () => {
      const { servicio } = montar();
      const vence = new Date(Date.now() + 60_000);
      const aprobacionId = await pedirPermiso(org, vence);
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      expect(enviada.caducaEn.getTime()).toBe(vence.getTime());
    });

    it('sin vencimiento en la aprobación, el enlace vale lo que dice la configuración', async () => {
      const ahora = new Date(Date.UTC(2026, 8, 20, 10));
      const { servicio } = montar(() => ahora, { AIW_APROBACION_VALIDEZ_HORAS: '2' });
      const aprobacionId = await pedirPermiso(org, null);
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      expect(enviada.caducaEn.getTime()).toBe(ahora.getTime() + 2 * 3600_000);
    });

    it('se puede forzar el destinatario sin tocar la ficha de la persona', async () => {
      const { servicio, correo } = montar();
      const aprobacionId = await pedirPermiso();
      await servicio.enviarSolicitud(org.tenantId, aprobacionId, { para: 'otro@example.com' });
      expect(correo.ultimo?.para).toBe('otro@example.com');
    });

    it('no manda un enlace de una aprobación ya vencida', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso(org, new Date(Date.now() - 1000));
      await expect(servicio.enviarSolicitud(org.tenantId, aprobacionId)).rejects.toThrow(
        /ya venció/,
      );
    });

    it('no manda dos veces el enlace de una aprobación ya decidida', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      await servicio.decidir(enviada.token, 'aprobar');
      await expect(servicio.enviarSolicitud(org.tenantId, aprobacionId)).rejects.toThrow(
        /ya está decidida/,
      );
    });

    it('la aprobación de otro tenant no se puede enviar desde este', async () => {
      const { servicio } = montar();
      const ajena = await pedirPermiso(otra);
      await expect(servicio.enviarSolicitud(org.tenantId, ajena)).rejects.toThrow(
        /No hay ninguna aprobación/,
      );
    });

    it('reintenta el envío y anota un intento por vez', async () => {
      const correo = new CorreoQueFalla({ falla: 2 });
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo,
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);

      expect(enviada.intentos).toBe(3);
      expect(correo.intentos).toBe(3);
      // Dos entradas de error y una de éxito: tres intentos, tres entradas.
      const resultados = await resultadosDe(org.tenantId, aprobacionId, ACCIONES.correoEnviado);
      expect(resultados).toEqual(['error', 'error', 'exito']);
    });

    it('si el envío no sale nunca, lanza y la aprobación queda sin decisión', async () => {
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo: new CorreoQueFalla({ falla: Number.POSITIVE_INFINITY }),
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      const aprobacionId = await pedirPermiso();
      await expect(servicio.enviarSolicitud(org.tenantId, aprobacionId)).rejects.toThrow(
        /no responde/,
      );
      expect(await resultadosDe(org.tenantId, aprobacionId, ACCIONES.correoEnviado)).toEqual([
        'error',
        'error',
        'error',
      ]);
      expect(await acciones(org.tenantId, aprobacionId)).not.toContain(ACCIONES.aprobada);
    });
  });

  describe('abrir el enlace', () => {
    it('muestra el resumen y anota la apertura, sin decidir', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const vista = await servicio.abrirEnlace(enviada.token);

      expect(vista.estado).toBe('mostrar');
      if (vista.estado !== 'mostrar') return;
      expect(vista.aprobacion.resumenLegible).toContain('Pagar 1.200 €');
      expect(await acciones(org.tenantId, aprobacionId)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
        ACCIONES.enlaceAbierto,
      ]);
    });

    it('abrirlo dos veces sigue sin decidir nada: los antivirus precargan enlaces', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      await servicio.abrirEnlace(enviada.token);
      const segunda = await servicio.abrirEnlace(enviada.token);

      expect(segunda.estado).toBe('mostrar');
      expect(await acciones(org.tenantId, aprobacionId)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
        ACCIONES.enlaceAbierto,
        ACCIONES.enlaceAbierto,
      ]);
    });

    it('un token manipulado no se muestra y no escribe en el libro de nadie', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const partes = enviada.token.split('.');
      const manipulado = [partes[0], partes[1], 'firmaFalsa'].join('.');

      expect(await servicio.abrirEnlace(manipulado)).toEqual({ estado: 'no_valido' });
      // Nada nuevo en el libro: una firma que no cuadra no se atribuye a ningún tenant.
      expect(await acciones(org.tenantId, aprobacionId)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
      ]);
    });

    it('un token caducado dice que caducó y lo anota, porque la firma es nuestra', async () => {
      const aprobacionId = await pedirPermiso(org, new Date(Date.now() + 60_000));
      const { servicio } = montar();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);

      const futuro = new Date(Date.now() + 120_000);
      const masTarde = montar(() => futuro).servicio;
      const vista = await masTarde.abrirEnlace(enviada.token);

      expect(vista.estado).toBe('caducado');
      expect(await acciones(org.tenantId, aprobacionId)).toContain(ACCIONES.enlaceRechazado);
    });

    it('un token de otro tenant contra una aprobación ajena no revela nada', async () => {
      const ajena = await pedirPermiso(otra);
      const { servicio } = montar();
      // Token firmado de verdad, con el tenant de `org` y la aprobación de `otra`.
      const token = firmarEnlace(
        new Secreto(CLAVE, 'AIW_APROBACION_CLAVE_FIRMA'),
        { tenantId: org.tenantId, aprobacionId: ajena, tareaId: org.tareaId },
        { caducaEn: new Date(Date.now() + 60_000) },
      );

      expect(await servicio.abrirEnlace(token)).toEqual({ estado: 'no_valido' });
      expect(await acciones(org.tenantId, ajena)).toEqual([ACCIONES.enlaceRechazado]);
      expect(await acciones(otra.tenantId, ajena)).toEqual([ACCIONES.solicitada]);
    });

    it('el enlace de una aprobación ya decidida lo dice y no vuelve a decidir', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      await servicio.decidir(enviada.token, 'rechazar');

      const vista = await servicio.abrirEnlace(enviada.token);
      expect(vista).toEqual({ estado: 'ya_decidida', sentido: 'rechazada' });
    });
  });

  describe('decidir por el enlace', () => {
    it('aprueba, registra la decisión y entrega la señal al flujo de la tarea', async () => {
      const { servicio, senal } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);

      const resultado = await servicio.decidir(enviada.token, 'aprobar');
      expect(resultado).toEqual({ estado: 'decidida', sentido: 'aprobada', senalEntregada: true });

      expect(senal.entregadas).toHaveLength(1);
      expect(senal.ultima?.destino).toEqual({
        flujoId: 'flujo-1',
        nombreSenal: 'decisionDeAprobacion',
      });
      expect(senal.ultima?.carga).toMatchObject({
        tenantId: org.tenantId,
        aprobacionId,
        tareaId: org.tareaId,
        sentido: 'aprobada',
        origen: 'correo',
        personaId: org.personaId,
      });
      expect(await acciones(org.tenantId, aprobacionId)).toEqual([
        ACCIONES.solicitada,
        ACCIONES.correoEnviado,
        ACCIONES.aprobada,
        ACCIONES.senalEntregada,
      ]);
    });

    it('rechaza y la señal lleva el sentido contrario', async () => {
      const { servicio, senal } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const resultado = await servicio.decidir(enviada.token, 'rechazar');

      expect(resultado).toMatchObject({ estado: 'decidida', sentido: 'rechazada' });
      expect(senal.ultima?.carga.sentido).toBe('rechazada');
    });

    it('el mismo enlace no decide dos veces', async () => {
      const { servicio, senal } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      await servicio.decidir(enviada.token, 'aprobar');
      const segunda = await servicio.decidir(enviada.token, 'rechazar');

      expect(segunda).toEqual({ estado: 'ya_decidida', sentido: 'aprobada' });
      // La segunda no manda otra señal: el flujo ya recibió la decisión.
      expect(senal.entregadas).toHaveLength(1);
    });

    it('un token manipulado no decide', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const roto = `${enviada.token.slice(0, -2)}xy`;
      expect(await servicio.decidir(roto, 'aprobar')).toEqual({ estado: 'no_valido' });
      expect(await acciones(org.tenantId, aprobacionId)).not.toContain(ACCIONES.aprobada);
    });

    it('la señal que no llega no deshace la decisión, y queda anotada como error', async () => {
      const senal = new SenalQueFalla({ falla: Number.POSITIVE_INFINITY });
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo: new CorreoEnMemoria(),
        senal,
        dormir: sinDormir,
      });
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const resultado = await servicio.decidir(enviada.token, 'aprobar');

      expect(resultado).toEqual({
        estado: 'decidida',
        sentido: 'aprobada',
        senalEntregada: false,
      });
      expect(senal.intentos).toBe(3);
      expect(await resultadosDe(org.tenantId, aprobacionId, ACCIONES.senalEntregada)).toEqual([
        'error',
        'error',
        'error',
      ]);
      // La decisión sigue ahí: es la verdad, y la señal es solo el aviso.
      const vista = await servicio.abrirEnlace(enviada.token);
      expect(vista).toMatchObject({ estado: 'ya_decidida', sentido: 'aprobada' });
    });

    it('la señal que falla y luego acierta anota los dos intentos', async () => {
      const senal = new SenalQueFalla({ falla: 1 });
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo: new CorreoEnMemoria(),
        senal,
        dormir: sinDormir,
      });
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const resultado = await servicio.decidir(enviada.token, 'aprobar');

      expect(resultado).toMatchObject({ senalEntregada: true });
      expect(await resultadosDe(org.tenantId, aprobacionId, ACCIONES.senalEntregada)).toEqual([
        'error',
        'exito',
      ]);
    });

    it('una tarea sin flujo se anota como error en vez de fallar en silencio', async () => {
      await conTenant(cliente, org.tenantId, async (tx) => {
        await tx`update tarea set flujo_temporal_id = null where tenant_id = ${org.tenantId} and id = ${org.tareaHijaId}`;
      });
      const aprobacionId = await conTenant(cliente, org.tenantId, (tx) =>
        solicitarAprobacion(tx, org.tenantId, {
          tareaId: org.tareaHijaId,
          personaId: org.personaId,
          claseAccion: 'pago.emitir',
          nivelExigido: 'n1',
          borradorOpaco: { tipo: 'pago', carga: {} },
          resumenLegible: 'Sin flujo al que señalar',
          venceEn: new Date(Date.now() + 60_000),
        }),
      ).then((pedida) => pedida.id);

      const { servicio, senal } = montar();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const resultado = await servicio.decidir(enviada.token, 'aprobar');

      expect(resultado).toMatchObject({ senalEntregada: false });
      expect(senal.entregadas).toHaveLength(0);
      expect(await resultadosDe(org.tenantId, aprobacionId, ACCIONES.senalEntregada)).toEqual([
        'error',
      ]);
    });
  });

  describe('vencer', () => {
    it('resuelve la vencida y avisa al flujo en nombre de la plataforma', async () => {
      const { servicio, senal } = montar();
      const aprobacionId = await pedirPermiso(org, new Date(Date.now() - 60_000));
      const cuantas = await servicio.vencer(org.tenantId);

      expect(cuantas).toBeGreaterThan(0);
      const entrega = senal.entregadas.find((e) => e.carga.aprobacionId === aprobacionId);
      expect(entrega?.carga.sentido).toBe('rechazada');
      expect(entrega?.carga.origen).toBe('plataforma');
      expect(entrega?.carga.personaId).toBeNull();
      expect(await acciones(org.tenantId, aprobacionId)).toContain(ACCIONES.vencida);
    });
  });

  describe('la bandera de funcionalidad', () => {
    it('apagada, ni envía ni abre ni decide', async () => {
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: leerConfiguracion({ AIW_APROBACION_CORREO: '0' }),
        correo: new CorreoEnMemoria(),
        senal: new SenalEnMemoria(),
      });
      const aprobacionId = await pedirPermiso();
      await expect(servicio.enviarSolicitud(org.tenantId, aprobacionId)).rejects.toThrow(
        ErrorBanderaApagada,
      );
      await expect(servicio.abrirEnlace('v1.a.b')).rejects.toThrow(ErrorBanderaApagada);
      await expect(servicio.decidir('v1.a.b', 'aprobar')).rejects.toThrow(ErrorBanderaApagada);
    });
  });

  describe('el servidor HTTP', () => {
    it('sirve salud, muestra la página y decide por POST', async () => {
      const { servicio, senal } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const enMarcha = await arrancarServidor({ servicio, puerto: 0 });
      const base = `http://127.0.0.1:${enMarcha.puerto}`;

      try {
        const salud = await fetch(`${base}/salud`);
        expect(salud.status).toBe(200);
        expect(await salud.json()).toEqual({ estado: 'ok' });

        const pagina = await fetch(`${base}/aprobaciones/${encodeURIComponent(enviada.token)}`);
        expect(pagina.status).toBe(200);
        expect(pagina.headers.get('cache-control')).toContain('no-store');
        expect(pagina.headers.get('referrer-policy')).toBe('no-referrer');
        expect(pagina.headers.get('content-security-policy')).toContain("default-src 'none'");
        const html = await pagina.text();
        expect(html).toContain('value="aprobar"');
        expect(html).not.toContain('<script>no</script>');

        const decision = await fetch(`${base}/aprobaciones/${encodeURIComponent(enviada.token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'sentido=aprobar',
        });
        expect(decision.status).toBe(200);
        expect(await decision.text()).toContain('Aprobado');
        expect(senal.entregadas).toHaveLength(1);

        const repetida = await fetch(`${base}/aprobaciones/${encodeURIComponent(enviada.token)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'sentido=rechazar',
        });
        expect(repetida.status).toBe(200);
        expect(await repetida.text()).toContain('ya se usó');
      } finally {
        await enMarcha.cerrar();
      }
    });

    it('un enlace no válido devuelve 404 genérico y uno caducado, 410', async () => {
      const aprobacionId = await pedirPermiso(org, new Date(Date.now() + 60_000));
      const { servicio } = montar();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const masTarde = montar(() => new Date(Date.now() + 120_000)).servicio;

      const noValida = await enrutar(servicio, peticion('GET', '/aprobaciones/v1.mal.firmado'));
      expect(noValida.estado).toBe(404);
      expect(noValida.cuerpo).toContain('Enlace no válido');

      const caducada = await enrutar(
        masTarde,
        peticion('GET', `/aprobaciones/${encodeURIComponent(enviada.token)}`),
      );
      expect(caducada.estado).toBe(410);
      expect(caducada.cuerpo).toContain('caducado');
    });

    it('una ruta desconocida y un método no admitido no filtran nada', async () => {
      const { servicio } = montar();
      const desconocida = await enrutar(servicio, peticion('GET', '/otra/cosa'));
      expect(desconocida.estado).toBe(404);

      const metodo = await enrutar(servicio, peticion('DELETE', '/aprobaciones/v1.a.b'));
      expect(metodo.estado).toBe(405);
      expect(metodo.cabeceras['allow']).toBe('GET, POST');

      const salud = await enrutar(servicio, peticion('POST', '/salud'));
      expect(salud.estado).toBe(405);
    });

    it('un POST sin el campo del formulario vuelve a mostrar la página', async () => {
      const { servicio } = montar();
      const aprobacionId = await pedirPermiso();
      const enviada = await servicio.enviarSolicitud(org.tenantId, aprobacionId);
      const respuesta = await enrutar(
        servicio,
        peticion('POST', `/aprobaciones/${encodeURIComponent(enviada.token)}`, 'sentido=quizá'),
      );
      expect(respuesta.estado).toBe(200);
      expect(respuesta.cuerpo).toContain('value="aprobar"');
      expect(await acciones(org.tenantId, aprobacionId)).not.toContain(ACCIONES.aprobada);
    });

    it('un cuerpo demasiado grande no se interpreta', async () => {
      const { servicio } = montar();
      await expect(
        enrutar(servicio, peticion('POST', '/aprobaciones/v1.a.b', 'x'.repeat(5000))),
      ).rejects.toThrow(/límite/);
    });
  });

  async function resultadosDe(
    tenantId: string,
    aprobacionId: string,
    accion: string,
  ): Promise<string[]> {
    return conTenant(cliente, tenantId, async (tx) => {
      const filas = await tx<{ resultado: string }[]>`
        select resultado from entrada_auditoria
        where tenant_id = ${tenantId} and accion = ${accion}
          and datos_referenciados @> ${JSON.stringify([{ tipo: 'aprobacion', id: aprobacionId }])}::text::jsonb
        order by numero_orden asc
      `;
      return filas.map((f) => f.resultado);
    });
  }
});

/** Petición de mentira para llamar al enrutador sin abrir un puerto. */
function peticion(metodo: string, url: string, cuerpo?: string): never {
  const trozos = cuerpo === undefined ? [] : [Buffer.from(cuerpo, 'utf8')];
  return {
    method: metodo,
    url,
    async *[Symbol.asyncIterator]() {
      for (const trozo of trozos) yield trozo;
    },
  } as never;
}
