/**
 * Consumo de la salida transaccional de eventos: el correo sale solo al crearse la
 * aprobación, sin que nadie llame a `enviarSolicitud` a mano.
 *
 * Contra PostgreSQL de verdad: lo que se comprueba es lo que solo la base
 * garantiza (el evento pendiente, el aislamiento por tenant, que un fallo no se
 * reintenta solo). Sin `DATABASE_URL` se salta con el mensaje de `@aiw/db/pruebas`.
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
import {
  DESTINO_EVENTO_APROBACION_CORREO,
  eventosPendientes,
  solicitarAprobacion,
} from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { leerConfiguracion, type ConfiguracionAprobacion } from '../aprobacion/configuracion.js';
import {
  escucharEventosDeAprobacion,
  procesarEventosDeAprobacion,
} from '../aprobacion/escucha-eventos.js';
import { ServicioDeAprobacion } from '../aprobacion/servicio.js';
import { CorreoEnMemoria } from '../correo/memoria.js';
import { SenalEnMemoria } from '../senal/memoria.js';

import { CorreoQueFalla, sinDormir } from './dobles.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'escucha de la salida transaccional de eventos'
  : `escucha de la salida transaccional de eventos — SALTADO. ${MOTIVO_SALTO}`;

const CLAVE = randomBytes(32).toString('hex');

function configuracion(): ConfiguracionAprobacion {
  return leerConfiguracion({
    AIW_APROBACION_CORREO: '1',
    AIW_APROBACION_CLAVE_FIRMA: CLAVE,
    AIW_APROBACION_URL_PUBLICA: 'https://aiw.example',
    AIW_CORREO_RETARDO_MS: '1',
  });
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let otra: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(8);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'escucha-eventos');
    otra = await sembrarOrganizacion(cliente, 'escucha-eventos-vecina');
  });

  afterAll(async () => {
    for (const sembrada of [org, otra]) {
      if (sembrada) await purgarOrganizacion(cliente, sembrada.tenantId);
    }
    await cliente.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  async function pedirPermiso(tenant: OrganizacionSembrada): Promise<string> {
    const pedida = await conTenant(cliente, tenant.tenantId, (tx) =>
      solicitarAprobacion(tx, tenant.tenantId, {
        tareaId: tenant.tareaId,
        pasoId: tenant.pasoId,
        personaId: tenant.personaId,
        claseAccion: 'pago.emitir',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'pago', carga: { opaco: true } },
        resumenLegible: 'Pagar 1.200 € a Suministros Pérez',
        venceEn: new Date(Date.now() + 86_400_000),
      }),
    );
    return pedida.id;
  }

  async function pendientesDe(tenantId: string): Promise<number> {
    const filas = await conTenant(cliente, tenantId, (tx) =>
      eventosPendientes(tx, tenantId, DESTINO_EVENTO_APROBACION_CORREO, 1000),
    );
    return filas.length;
  }

  describe('procesarEventosDeAprobacion', () => {
    it('manda el correo de la aprobación pendiente y la saca de pendientes', async () => {
      const correo = new CorreoEnMemoria();
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo,
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      await pedirPermiso(org);

      const procesados = await procesarEventosDeAprobacion(cliente, servicio, org.tenantId);

      expect(procesados).toBeGreaterThanOrEqual(1);
      expect(correo.enviados.some((c) => c.asunto.length > 0)).toBe(true);
      expect(await pendientesDe(org.tenantId)).toBe(0);
    });

    it('un correo que falla siempre marca el evento fallido, sin lanzar y sin reintentarlo solo', async () => {
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo: new CorreoQueFalla({ falla: Infinity }),
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      await pedirPermiso(org);

      await expect(
        procesarEventosDeAprobacion(cliente, servicio, org.tenantId),
      ).resolves.not.toThrow();
      expect(await pendientesDe(org.tenantId)).toBe(0);
    });

    it('no toca los eventos de otro tenant', async () => {
      const correo = new CorreoEnMemoria();
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo,
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      await pedirPermiso(otra);
      const antesDeOrg = await pendientesDe(org.tenantId);

      await procesarEventosDeAprobacion(cliente, servicio, org.tenantId);

      expect(await pendientesDe(org.tenantId)).toBe(antesDeOrg);
      expect(await pendientesDe(otra.tenantId)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('escucharEventosDeAprobacion', () => {
    it('procesa los pendientes del tenant vigilado al cabo de un sondeo, y para al llamar a parar()', async () => {
      const correo = new CorreoEnMemoria();
      const servicio = new ServicioDeAprobacion({
        cliente,
        configuracion: configuracion(),
        correo,
        senal: new SenalEnMemoria(),
        dormir: sinDormir,
      });
      await pedirPermiso(org);

      const escucha = escucharEventosDeAprobacion({
        cliente,
        servicio,
        tenantIds: [org.tenantId],
        intervaloMs: 20,
      });
      try {
        await new Promise((resolver) => setTimeout(resolver, 150));
        expect(await pendientesDe(org.tenantId)).toBe(0);
      } finally {
        escucha.parar();
      }
    });
  });
});
