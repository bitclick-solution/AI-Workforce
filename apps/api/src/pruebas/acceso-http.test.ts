/**
 * Acceso al panel de punta a punta: Better Auth real, PostgreSQL con RLS y el
 * servidor de la API escuchando.
 *
 * Lo que se comprueba es lo que pide la rebanada, en el orden en que lo vive una
 * persona: la invitan, pide su enlace, entra, ve los datos de su organización y no
 * los de otra, registra una passkey, sale, vuelve con la passkey, su sesión caduca.
 * Y en cada paso, lo que no debe pasar: sin sesión no hay datos, un correo no
 * invitado no recibe nada, el enlace sirve una vez, una cabecera de tenant no
 * cambia nada y no hay sesión sin su entrada en el libro.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` se salta con un mensaje.
 */
import {
  ROL_APLICACION,
  ROL_IDENTIDAD,
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
import { verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAcceso, puertoIdentidad } from '../identidad/acceso';
import { ACCIONES_ACCESO, METODOS_ACCESO, anotadorConBaseDeDatos } from '../identidad/auditoria';
import { configuracionAccesoDesdeEntorno } from '../identidad/configuracion';
import { CorreoEnMemoria } from '../identidad/correo';
import { invitarPropietario, type InvitacionHecha } from '../identidad/invitar';
import { BANDERA, VARIABLE_AUTORIZACION } from '../rutas/contador';
import { arrancarApi, type ApiEnMarcha } from '../servidor';
import { AutenticadorDePrueba } from './autenticador';
import { NavegadorDePrueba, ORIGEN_PANEL, secretoDePrueba } from './navegador';

const TITULO = HAY_BASE_DE_DATOS
  ? 'acceso al panel por HTTP'
  : `acceso al panel por HTTP — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  const tokenContador = secretoDePrueba();
  const secreto = secretoDePrueba();
  const sufijo = uuidV7().slice(-12);
  const correoAlfa = `ana-${sufijo}@alfa.example`;
  const correoBeta = `bruno-${sufijo}@beta.example`;
  const correo = new CorreoEnMemoria();
  const entorno = {
    [BANDERA]: '1',
    [VARIABLE_AUTORIZACION]: tokenContador,
    AIW_ACCESO_PANEL: '1',
    AIW_ACCESO_SECRETO: secreto,
    AIW_WEB_URL_PUBLICA: ORIGEN_PANEL,
    AIW_API_PUERTO: '0',
    DATABASE_URL: URL_BASE_DE_DATOS,
  };

  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  let api: ApiEnMarcha;
  let alfa: OrganizacionSembrada;
  let beta: OrganizacionSembrada;
  let invitacionAlfa: InvitacionHecha;
  let invitacionBeta: InvitacionHecha;

  const navegador = () => new NavegadorDePrueba(`http://127.0.0.1:${api.puerto}`);
  const contador = (nav: NavegadorDePrueba, ruta: string, extra: Record<string, string> = {}) =>
    nav.pedir(ruta, { cabeceras: { authorization: `Bearer ${tokenContador}`, ...extra } });

  async function accionesDe(
    tenantId: string,
  ): Promise<{ accion: string; herramienta: string | null }[]> {
    return conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ accion: string; herramienta: string | null }[]>`
      select accion, herramienta from entrada_auditoria
      where tenant_id = ${tenantId} and accion like 'acceso.%'
      order by numero_orden
    `,
    );
  }

  async function sesionesDe(usuarioId: string): Promise<number> {
    const [fila] = await cliente<{ total: string }[]>`
      select count(*) as total from sesion where usuario_id = ${usuarioId}
    `;
    return Number(fila?.total);
  }

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    alfa = await sembrarOrganizacion(cliente, `acceso-alfa-${sufijo}`);
    beta = await sembrarOrganizacion(cliente, `acceso-beta-${sufijo}`);
    invitacionAlfa = await invitarPropietario(cliente, {
      tenantId: alfa.tenantId,
      nombre: 'Ana Alfa',
      correo: correoAlfa,
    });
    invitacionBeta = await invitarPropietario(cliente, {
      tenantId: beta.tenantId,
      nombre: 'Bruno Beta',
      correo: correoBeta,
    });
    // El servidor corre con el rol de aplicación y la identidad con el suyo, como en
    // producción: si algo se apoyara en ser superusuario, aquí se vería.
    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });
    api = await arrancarApi({ conexion, entorno, correoAcceso: correo });
  });

  afterAll(async () => {
    await api?.cerrar();
    await conexion?.cerrar();
    if (alfa) await purgarOrganizacion(cliente, alfa.tenantId);
    if (beta) await purgarOrganizacion(cliente, beta.tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('la invitación crea la persona y el usuario y queda en el libro', async () => {
    expect(invitacionAlfa.tenantId).toBe(alfa.tenantId);
    const acciones = await accionesDe(alfa.tenantId);
    expect(acciones.map((a) => a.accion)).toContain(ACCIONES_ACCESO.propietarioInvitado);
  });

  it('sin sesión no hay datos, traiga la cabecera de tenant que traiga', async () => {
    const nav = navegador();
    const sinNada = await contador(nav, '/contador/periodo');
    expect(sinNada.estado).toBe(401);
    const conCabecera = await contador(nav, '/contador/tareas', {
      'x-aiw-tenant': alfa.tenantId,
      'x-aiw-persona': invitacionAlfa.personaId,
    });
    expect(conCabecera.estado).toBe(401);
    expect(JSON.stringify(conCabecera.cuerpo)).not.toContain(alfa.tareaId);
    const cookieInventada = await contador(nav, '/contador/tareas', {
      cookie: 'aiw.session_token=inventada.firma',
    });
    expect(cookieInventada.estado).toBe(401);
  });

  it('un correo invitado recibe un enlace de un solo uso que abre la sesión', async () => {
    const nav = navegador();
    const abierta = await nav.entrarConEnlace(correo, correoAlfa);
    expect(abierta.estado).toBe(302);
    expect(abierta.cabeceras.get('location')).toBe(`${ORIGEN_PANEL}/panel/cuenta`);
    expect(nav.cookies.has('aiw.session_token')).toBe(true);

    const sesion = await nav.pedir('/api/auth/get-session');
    expect((sesion.cuerpo as { user: { email: string } }).user.email).toBe(correoAlfa);

    // El mismo enlace otra vez: ya no sirve y no da cookie nueva.
    const enlace = /\/api\/auth\/magic-link\/verify\?\S+/.exec(correo.ultimo?.texto ?? '')?.[0];
    const otroNavegador = navegador();
    const repetida = await otroNavegador.pedir(enlace ?? '/');
    expect(repetida.cabeceras.get('location')).toContain('error=INVALID_TOKEN');
    expect(otroNavegador.cookies.has('aiw.session_token')).toBe(false);
  });

  it('el enlace se guarda con hash: el token del correo no está en la base', async () => {
    const nav = navegador();
    await nav.pedir('/api/auth/sign-in/magic-link', {
      metodo: 'POST',
      cuerpo: { email: correoAlfa },
    });
    const token = new URL(
      /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/.exec(correo.ultimo?.texto ?? '')?.[0] ??
        'http://x/',
    ).searchParams.get('token');
    expect(token).toBeTruthy();
    const [fila] = await cliente<{ total: string }[]>`
      select count(*) as total from verificacion where identificador = ${token ?? ''}
    `;
    expect(Number(fila?.total)).toBe(0);
  });

  it('con la sesión de otra organización, cero filas de la primera', async () => {
    const nav = navegador();
    expect((await nav.entrarConEnlace(correo, correoBeta)).estado).toBe(302);
    const tareas = await contador(nav, '/contador/tareas', { 'x-aiw-tenant': alfa.tenantId });
    expect(tareas.estado).toBe(200);
    const ids = (tareas.cuerpo as { tareas: { tareaId: string }[] }).tareas.map((t) => t.tareaId);
    expect(ids).not.toContain(alfa.tareaId);
    expect(ids).toContain(beta.tareaId);

    const navAlfa = navegador();
    await navAlfa.entrarConEnlace(correo, correoAlfa);
    const propias = await contador(navAlfa, '/contador/tareas');
    const idsAlfa = (propias.cuerpo as { tareas: { tareaId: string }[] }).tareas.map(
      (t) => t.tareaId,
    );
    expect(idsAlfa).toContain(alfa.tareaId);
    expect(idsAlfa).not.toContain(beta.tareaId);
  });

  it('un correo no invitado no recibe nada, no crea usuario y la respuesta no lo delata', async () => {
    const nav = navegador();
    const antes = correo.enviados.length;
    const desconocido = `nadie-${sufijo}@fuera.example`;
    const respuesta = await nav.pedir('/api/auth/sign-in/magic-link', {
      metodo: 'POST',
      cuerpo: { email: desconocido },
    });
    expect(respuesta.estado).toBe(200);
    expect(respuesta.cuerpo).toEqual({ status: true });
    expect(correo.enviados.length).toBe(antes);
    const [fila] = await cliente<{ total: string }[]>`
      select count(*) as total from usuario where correo = ${desconocido}
    `;
    expect(Number(fila?.total)).toBe(0);
  });

  it('cerrar la sesión la borra en el momento y queda en el libro', async () => {
    const nav = navegador();
    await nav.entrarConEnlace(correo, correoAlfa);
    const cookie = nav.cabeceraCookie();
    expect((await contador(nav, '/contador/periodo')).estado).toBe(200);

    const salida = await nav.pedir('/api/auth/sign-out', { metodo: 'POST', cuerpo: {} });
    expect(salida.estado).toBe(200);
    expect(nav.cookies.has('aiw.session_token')).toBe(false);

    // La cookie vieja, guardada por quien fuera, ya no vale.
    const vieja = await contador(navegador(), '/contador/periodo', { cookie });
    expect(vieja.estado).toBe(401);
    const acciones = (await accionesDe(alfa.tenantId)).map((a) => a.accion);
    expect(acciones).toContain(ACCIONES_ACCESO.sesionCerrada);
  });

  it('una passkey se registra con sesión y después entra sin correo, en localhost', async () => {
    const autenticador = new AutenticadorDePrueba('localhost', ORIGEN_PANEL);
    const nav = navegador();
    await nav.entrarConEnlace(correo, correoAlfa);

    const opciones = await nav.pedir('/api/auth/passkey/generate-register-options');
    expect(opciones.estado).toBe(200);
    const registro = opciones.cuerpo as { challenge: string; rp: { id: string } };
    expect(registro.rp.id).toBe('localhost');
    const registrada = await nav.pedir('/api/auth/passkey/verify-registration', {
      metodo: 'POST',
      cuerpo: { response: autenticador.registrar(registro.challenge), name: 'Portátil' },
    });
    expect(registrada.estado).toBe(200);
    await nav.pedir('/api/auth/sign-out', { metodo: 'POST', cuerpo: {} });

    const correosAntes = correo.enviados.length;
    const nuevo = navegador();
    const reto = await nuevo.pedir('/api/auth/passkey/generate-authenticate-options');
    expect(reto.estado).toBe(200);
    const { challenge } = reto.cuerpo as { challenge: string };
    const entrada = await nuevo.pedir('/api/auth/passkey/verify-authentication', {
      metodo: 'POST',
      cuerpo: { response: autenticador.firmar(challenge) },
    });
    expect(entrada.estado).toBe(200);
    expect(nuevo.cookies.has('aiw.session_token')).toBe(true);
    expect(correo.enviados.length).toBe(correosAntes);
    expect((await contador(nuevo, '/contador/periodo')).estado).toBe(200);

    const conPasskey = (await accionesDe(alfa.tenantId)).filter(
      (a) =>
        a.accion === ACCIONES_ACCESO.sesionIniciada && a.herramienta === METODOS_ACCESO.passkey,
    );
    expect(conPasskey.length).toBeGreaterThan(0);
  });

  it('una passkey firmada para otro origen no abre sesión', async () => {
    const intrusa = new AutenticadorDePrueba('localhost', 'http://localhost:4444');
    const nav = navegador();
    await nav.entrarConEnlace(correo, correoBeta);
    const opciones = await nav.pedir('/api/auth/passkey/generate-register-options');
    const registro = opciones.cuerpo as { challenge: string };
    const registrada = await nav.pedir('/api/auth/passkey/verify-registration', {
      metodo: 'POST',
      cuerpo: { response: intrusa.registrar(registro.challenge) },
    });
    // Better Auth lo rechaza como fallo de verificación; lo que importa es que la
    // clave no queda guardada.
    expect(registrada.estado).toBeGreaterThanOrEqual(400);
    const [claves] = await cliente<{ total: string }[]>`
      select count(*) as total from clave_acceso where usuario_id = ${invitacionBeta.usuarioId}
    `;
    expect(Number(claves?.total)).toBe(0);
  });

  it('una sesión caducada no vale, se borra al presentarse y queda en el libro', async () => {
    const nav = navegador();
    await nav.entrarConEnlace(correo, correoBeta);
    const sesionesAntes = await sesionesDe(invitacionBeta.usuarioId);
    await cliente`
      update sesion set caduca_en = now() - interval '1 minute'
      where usuario_id = ${invitacionBeta.usuarioId}
    `;
    expect((await contador(nav, '/contador/periodo')).estado).toBe(401);
    expect(await sesionesDe(invitacionBeta.usuarioId)).toBeLessThan(sesionesAntes);
    const acciones = (await accionesDe(beta.tenantId)).map((a) => a.accion);
    expect(acciones).toContain(ACCIONES_ACCESO.sesionCaducada);
  });

  it('una persona desactivada pierde el acceso y no recibe enlaces', async () => {
    const nav = navegador();
    await nav.entrarConEnlace(correo, correoBeta);
    expect((await contador(nav, '/contador/periodo')).estado).toBe(200);
    const desactivar = (activa: boolean) =>
      conTenant(
        cliente,
        beta.tenantId,
        (tx) => tx`
        update persona set activa = ${activa} where id = ${invitacionBeta.personaId}
      `,
      );
    await desactivar(false);
    try {
      expect((await contador(nav, '/contador/periodo')).estado).toBe(401);
      const antes = correo.enviados.length;
      await navegador().pedir('/api/auth/sign-in/magic-link', {
        metodo: 'POST',
        cuerpo: { email: correoBeta },
      });
      expect(correo.enviados.length).toBe(antes);
    } finally {
      await desactivar(true);
    }
  });

  it('cada inicio, cierre y caducidad queda en su cadena, verificada y contada', async () => {
    const acciones = (await accionesDe(alfa.tenantId)).map((a) => a.accion);
    for (const accion of [
      ACCIONES_ACCESO.propietarioInvitado,
      ACCIONES_ACCESO.enlaceEnviado,
      ACCIONES_ACCESO.sesionIniciada,
      ACCIONES_ACCESO.sesionCerrada,
    ]) {
      expect(acciones, `falta ${accion}`).toContain(accion);
    }
    expect((await verificarCadenaEnBase(cliente, alfa.tenantId)).valida).toBe(true);
    expect((await verificarCadenaEnBase(cliente, beta.tenantId)).valida).toBe(true);
    // Ninguna entrada del acceso de beta cayó en la cadena de alfa.
    const [cruzadas] = await cliente<{ total: string }[]>`
      select count(*) as total from entrada_auditoria
      where tenant_id = ${alfa.tenantId} and actor_id = ${invitacionBeta.personaId}
    `;
    expect(Number(cruzadas?.total)).toBe(0);
    const [consumo] = await conTenant(
      cliente,
      alfa.tenantId,
      (tx) => tx<{ acciones: string }[]>`
      select sum(acciones) as acciones from contador_consumo where tenant_id = ${alfa.tenantId}
    `,
    );
    expect(Number(consumo?.acciones)).toBeGreaterThanOrEqual(acciones.length);
  });

  it('sin entrada en el libro no hay sesión ni cookie', async () => {
    const configuracion = configuracionAccesoDesdeEntorno(entorno);
    if (!configuracion) throw new Error('La configuración de la prueba no activa el acceso.');
    const identidad = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_IDENTIDAD });
    const correoLocal = new CorreoEnMemoria();
    const anotadorReal = anotadorConBaseDeDatos(conexion.cliente);
    try {
      const acceso = crearAcceso({
        configuracion,
        dbIdentidad: identidad.crearDb(),
        puerto: puertoIdentidad(identidad.cliente, conexion.cliente),
        // El libro acepta el envío del enlace y falla justo al anotar el inicio.
        anotador: async (tenantId, anotacion) => {
          if (anotacion.accion === ACCIONES_ACCESO.sesionIniciada) {
            throw new Error('el libro no responde');
          }
          await anotadorReal(tenantId, anotacion);
        },
        correo: correoLocal,
      });
      const pedida = await acceso.manejar(
        new Request(`${ORIGEN_PANEL}/api/auth/sign-in/magic-link`, {
          method: 'POST',
          headers: { origin: ORIGEN_PANEL, 'content-type': 'application/json' },
          body: JSON.stringify({ email: correoAlfa, callbackURL: '/panel/cuenta' }),
        }),
      );
      expect(pedida.status).toBe(200);
      const enlace = /https?:\/\/\S+\/api\/auth\/magic-link\/verify\?\S+/.exec(
        correoLocal.ultimo?.texto ?? '',
      )?.[0];
      const sesionesAntes = await sesionesDe(invitacionAlfa.usuarioId);
      const abierta = await acceso.manejar(new Request(enlace ?? ORIGEN_PANEL));
      expect(abierta.status).toBeGreaterThanOrEqual(400);
      const conSesion = abierta.headers
        .getSetCookie()
        .filter((c) => /^aiw\.session_token=[^;]/.test(c));
      expect(conSesion).toEqual([]);
      expect(await sesionesDe(invitacionAlfa.usuarioId)).toBe(sesionesAntes);
    } finally {
      await identidad.cerrar();
    }
  });
});
