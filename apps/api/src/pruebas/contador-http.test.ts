/**
 * El contador por HTTP, de punta a punta: servidor, rol de aplicación y RLS.
 *
 * Las pruebas de `rutas/contador.test.ts` cubren la puerta sin base de datos; esta
 * comprueba lo que solo se ve montado: que la petición abre una transacción con el
 * tenant de la sesión fijado, que el rol `aiw_app` no ve nada de otro tenant y que
 * el servidor responde 404 a lo que no es suyo. Cada organización entra con su
 * propia sesión de Better Auth, como en el panel.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import {
  ROL_APLICACION,
  aplicarMigraciones,
  conTenant,
  crearConexion,
  purgarOrganizacion,
  uuidV7,
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

import { CorreoEnMemoria } from '../identidad/correo';
import { invitarPropietario } from '../identidad/invitar';
import { BANDERA, VARIABLE_AUTORIZACION } from '../rutas/contador';
import { arrancarApi, type ApiEnMarcha } from '../servidor';
import { NavegadorDePrueba, secretoDePrueba } from './navegador';

const CLAVE = 'valor-de-prueba-del-contador-http';
const CABECERA_TENANT = 'x-aiw-tenant';
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

  const correo = new CorreoEnMemoria();
  const sufijo = uuidV7().slice(-12);
  let navOrg: NavegadorDePrueba;
  let navVecina: NavegadorDePrueba;

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

  /** Token del panel y la cookie de la sesión de quien pregunta. */
  function cabecerasDe(nav: NavegadorDePrueba): Record<string, string> {
    return { authorization: `Bearer ${CLAVE}`, cookie: nav.cabeceraCookie() };
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
        AIW_ACCESO_PANEL: '1',
        AIW_ACCESO_SECRETO: secretoDePrueba(),
        DATABASE_URL: URL_BASE_DE_DATOS,
      },
      correoAcceso: correo,
    });

    const correoOrg = `org-${sufijo}@contador.example`;
    const correoVecina = `vecina-${sufijo}@contador.example`;
    await invitarPropietario(cliente, { tenantId: org.tenantId, nombre: 'Org', correo: correoOrg });
    await invitarPropietario(cliente, {
      tenantId: vecina.tenantId,
      nombre: 'Vecina',
      correo: correoVecina,
    });
    navOrg = new NavegadorDePrueba(`http://127.0.0.1:${api.puerto}`);
    navVecina = new NavegadorDePrueba(`http://127.0.0.1:${api.puerto}`);
    await navOrg.entrarConEnlace(correo, correoOrg);
    await navVecina.entrarConEnlace(correo, correoVecina);
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
    const { estado, cuerpo } = await pedir('/contador/periodo', cabecerasDe(navOrg));
    expect(estado).toBe(200);
    expect(Number(cuerpo['tareas'])).toBeGreaterThan(0);
    expect(Number(cuerpo['costeModelosEuros'])).toBeCloseTo(0.9, 4);
    expect(Number(cuerpo['ultimaAnotacion'])).toBeGreaterThan(0);
  });

  it('las tareas del periodo traen la raíz con su coste', async () => {
    const { estado, cuerpo } = await pedir('/contador/tareas?limite=5', cabecerasDe(navOrg));
    expect(estado).toBe(200);
    const tareas = cuerpo['tareas'] as { tareaId: string; costeModelosEuros: number }[];
    expect(tareas.some((t) => t.tareaId === org.tareaId)).toBe(true);
  });

  it('el coste por puesto llega agrupado', async () => {
    const { estado, cuerpo } = await pedir('/contador/coste-por-puesto', cabecerasDe(navOrg));
    expect(estado).toBe(200);
    const puestos = cuerpo['puestos'] as { puesto: string; costeModelosEuros: number }[];
    expect(puestos[0]?.puesto).toBe('Contable');
    expect(puestos[0]?.costeModelosEuros).toBeCloseTo(0.9, 4);
  });

  it('el vecino pregunta lo mismo y recibe ceros: la RLS no se lo salta', async () => {
    // Aunque pida el tenant de la otra organización por cabecera.
    const { estado, cuerpo } = await pedir('/contador/periodo', {
      ...cabecerasDe(navVecina),
      [CABECERA_TENANT]: org.tenantId,
    });
    expect(estado).toBe(200);
    expect(Number(cuerpo['costeModelosEuros'])).toBe(0);
    expect(Number(cuerpo['tareas'])).toBe(2); // Lo que dejó la semilla, nada de la otra.

    const puestos = await pedir('/contador/coste-por-puesto', cabecerasDe(navVecina));
    expect(puestos.cuerpo['puestos']).toEqual([]);
  });

  it('sin token no se lee nada, ni con sesión', async () => {
    const { estado } = await pedir('/contador/periodo', { cookie: navOrg.cabeceraCookie() });
    expect(estado).toBe(401);
  });

  it('sin sesión no se lee nada, ni con la cabecera de tenant', async () => {
    const { estado } = await pedir('/contador/periodo', {
      authorization: `Bearer ${CLAVE}`,
      [CABECERA_TENANT]: org.tenantId,
    });
    expect(estado).toBe(401);
  });

  it('lo que no es del contador es 404 y no filtra nada', async () => {
    const { estado, cuerpo } = await pedir('/aprobaciones/1', cabecerasDe(navOrg));
    expect(estado).toBe(404);
    expect(JSON.stringify(cuerpo)).not.toContain(CLAVE);
  });
});
