/**
 * El contador por HTTP, de punta a punta: servidor, rol de aplicación y RLS.
 *
 * Las pruebas de `rutas/contador.test.ts` cubren la puerta sin base de datos; esta
 * comprueba lo que solo se ve montado: que la petición abre una transacción con el
 * tenant fijado, que el rol `aiw_app` no ve nada de otro tenant y que el servidor
 * responde 404 a lo que no es suyo.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import {
  ROL_APLICACION,
  aplicarMigraciones,
  conTenant,
  crearConexion,
  purgarOrganizacion,
} from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import { registrarTareaRaiz, registrarTarifa, registrarUsoDeModelo } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BANDERA, CABECERA_TENANT, VARIABLE_AUTORIZACION } from '../rutas/contador';
import { arrancarApi, type ApiEnMarcha } from '../servidor';

const CLAVE = 'valor-de-prueba-del-contador-http';
const PROVEEDOR = 'proveedor-de-prueba';
const MODELO = 'modelo-de-prueba';

const TITULO = HAY_BASE_DE_DATOS
  ? 'contador por HTTP'
  : `contador por HTTP — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  let api: ApiEnMarcha;
  let org: OrganizacionSembrada;
  let vecina: OrganizacionSembrada;

  async function pedir(
    ruta: string,
    cabeceras: Record<string, string>,
  ): Promise<{ estado: number; cuerpo: Record<string, unknown> }> {
    const respuesta = await fetch(`http://127.0.0.1:${api.puerto}${ruta}`, { headers: cabeceras });
    const texto = await respuesta.text();
    return {
      estado: respuesta.status,
      cuerpo: texto.length > 0 ? (JSON.parse(texto) as Record<string, unknown>) : {},
    };
  }

  function cabecerasDe(tenantId: string): Record<string, string> {
    return { authorization: `Bearer ${CLAVE}`, [CABECERA_TENANT]: tenantId };
  }

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'contador-http');
    vecina = await sembrarOrganizacion(cliente, 'contador-http-vecina');

    await conTenant(cliente, org.tenantId, async (tx) => {
      await registrarTarifa(tx, org.tenantId, {
        proveedor: PROVEEDOR,
        modelo: MODELO,
        eurosPorMillonEntrada: 3,
        eurosPorMillonSalida: 15,
        vigenteDesde: new Date('2026-01-01T00:00:00.000Z'),
        fuente: 'prueba',
      });
      await registrarTareaRaiz(tx, org.tenantId, {
        tareaId: org.tareaId,
        puestoId: org.puestoId,
        versionPuestoId: org.versionPuestoId,
      });
      await registrarUsoDeModelo(tx, org.tenantId, {
        tareaId: org.tareaId,
        pasoId: org.pasoId,
        puestoId: org.puestoId,
        versionPuestoId: org.versionPuestoId,
        proveedor: PROVEEDOR,
        modelo: MODELO,
        tokens: { entrada: 200_000, salida: 20_000 },
        claveIdempotencia: 'http-1',
      });
    });

    // El servidor corre con el rol de aplicación, igual que en producción: si una
    // consulta se apoyara en ser superusuario, aquí se vería.
    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });
    api = await arrancarApi({
      conexion,
      entorno: {
        [BANDERA]: '1',
        [VARIABLE_AUTORIZACION]: CLAVE,
        AIW_API_PUERTO: '0',
        DATABASE_URL: URL_BASE_DE_DATOS,
      },
    });
  });

  afterAll(async () => {
    await api?.cerrar();
    await conexion?.cerrar();
    if (org) await purgarOrganizacion(cliente, org.tenantId);
    if (vecina) await purgarOrganizacion(cliente, vecina.tenantId);
    await cliente?.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  it('el consumo del periodo llega con el coste de los usos reales', async () => {
    const { estado, cuerpo } = await pedir('/contador/periodo', cabecerasDe(org.tenantId));
    expect(estado).toBe(200);
    expect(Number(cuerpo['tareas'])).toBeGreaterThan(0);
    expect(Number(cuerpo['costeModelosEuros'])).toBeCloseTo(0.9, 4);
    expect(Number(cuerpo['ultimaAnotacion'])).toBeGreaterThan(0);
  });

  it('las tareas del periodo traen la raíz con su coste', async () => {
    const { estado, cuerpo } = await pedir('/contador/tareas?limite=5', cabecerasDe(org.tenantId));
    expect(estado).toBe(200);
    const tareas = cuerpo['tareas'] as { tareaId: string; costeModelosEuros: number }[];
    expect(tareas.some((t) => t.tareaId === org.tareaId)).toBe(true);
  });

  it('el coste por puesto llega agrupado', async () => {
    const { estado, cuerpo } = await pedir('/contador/coste-por-puesto', cabecerasDe(org.tenantId));
    expect(estado).toBe(200);
    const puestos = cuerpo['puestos'] as { puesto: string; costeModelosEuros: number }[];
    expect(puestos[0]?.puesto).toBe('Contable');
    expect(puestos[0]?.costeModelosEuros).toBeCloseTo(0.9, 4);
  });

  it('el vecino pregunta lo mismo y recibe ceros: la RLS no se lo salta', async () => {
    const { estado, cuerpo } = await pedir('/contador/periodo', cabecerasDe(vecina.tenantId));
    expect(estado).toBe(200);
    expect(Number(cuerpo['costeModelosEuros'])).toBe(0);
    expect(Number(cuerpo['tareas'])).toBe(2); // Lo que dejó la semilla, nada de la otra.

    const puestos = await pedir('/contador/coste-por-puesto', cabecerasDe(vecina.tenantId));
    expect(puestos.cuerpo['puestos']).toEqual([]);
  });

  it('sin token no se lee nada', async () => {
    const { estado } = await pedir('/contador/periodo', { [CABECERA_TENANT]: org.tenantId });
    expect(estado).toBe(401);
  });

  it('con un tenant que no es UUID responde 400', async () => {
    const { estado } = await pedir('/contador/periodo', {
      authorization: `Bearer ${CLAVE}`,
      [CABECERA_TENANT]: 'alfa',
    });
    expect(estado).toBe(400);
  });

  it('lo que no es del contador es 404 y no filtra nada', async () => {
    const { estado, cuerpo } = await pedir('/aprobaciones/1', cabecerasDe(org.tenantId));
    expect(estado).toBe(404);
    expect(JSON.stringify(cuerpo)).not.toContain(CLAVE);
  });
});
