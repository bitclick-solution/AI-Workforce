/**
 * Piezas del acceso que se prueban sin base de datos: configuración, reintentos
 * del libro, validación de la invitación, plantillas y la traducción entre
 * `node:http` y `Request`/`Response`.
 */
import { createServer, type Server } from 'node:http';
import { inspect } from 'node:util';

import type postgres from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CuerpoDemasiadoGrande,
  TOPE_CUERPO_ACCESO,
  aPeticionWeb,
  escribirRespuestaWeb,
  esRutaDeAcceso,
} from '../rutas/acceso';
import { secretoDePrueba } from '../pruebas/navegador';
import { SIN_SESION, descripcionSaneada, registroSaneado } from './acceso';
import { ACCIONES_ACCESO, anotadorConBaseDeDatos } from './auditoria';
import {
  HORAS_SESION_POR_DEFECTO,
  MINUTOS_ENLACE_POR_DEFECTO,
  accesoActivo,
  configuracionAccesoDesdeEntorno,
} from './configuracion';
import { CorreoEnMemoria, correoDeEnlace, correoDeInvitacion } from './correo';
import { InvitacionNoValida, validarInvitacion } from './invitar';
import { TEXTO_OCULTO } from './secreto';

const TENANT = '01929f00-0000-7000-8000-0000000000e1';

describe('configuración del acceso', () => {
  it('sin bandera no hay acceso, y el secreto no se pide', () => {
    expect(accesoActivo({})).toBe(false);
    expect(configuracionAccesoDesdeEntorno({})).toBeUndefined();
    expect(configuracionAccesoDesdeEntorno({ AIW_ACCESO_PANEL: '0' })).toBeUndefined();
  });

  it('con bandera exige un secreto de 32 caracteres o más, y no vale GENERAR', () => {
    for (const secreto of [undefined, '', 'GENERAR', 'corto']) {
      expect(() =>
        configuracionAccesoDesdeEntorno({ AIW_ACCESO_PANEL: '1', AIW_ACCESO_SECRETO: secreto }),
      ).toThrow(/AIW_ACCESO_SECRETO/);
    }
  });

  it('con bandera y secreto trae los valores por defecto de local', () => {
    const configuracion = configuracionAccesoDesdeEntorno({
      AIW_ACCESO_PANEL: '1',
      AIW_ACCESO_SECRETO: secretoDePrueba(),
    });
    expect(configuracion?.urlPublica).toBe('http://localhost:3000');
    expect(configuracion?.horasSesion).toBe(HORAS_SESION_POR_DEFECTO);
    expect(configuracion?.minutosEnlace).toBe(MINUTOS_ENLACE_POR_DEFECTO);
    expect(configuracion?.correo.proveedor).toBe('memoria');
  });

  it('fuera de localhost la URL pública tiene que ser https', () => {
    const base = { AIW_ACCESO_PANEL: '1', AIW_ACCESO_SECRETO: secretoDePrueba() };
    expect(() =>
      configuracionAccesoDesdeEntorno({ ...base, AIW_WEB_URL_PUBLICA: 'http://panel.example' }),
    ).toThrow(/https/);
    expect(
      configuracionAccesoDesdeEntorno({ ...base, AIW_WEB_URL_PUBLICA: 'https://panel.example/x' })
        ?.urlPublica,
    ).toBe('https://panel.example');
  });

  it('el secreto no se imprime ni en JSON ni al inspeccionar la configuración', () => {
    const secreto = secretoDePrueba();
    const configuracion = configuracionAccesoDesdeEntorno({
      AIW_ACCESO_PANEL: '1',
      AIW_ACCESO_SECRETO: secreto,
    });
    expect(JSON.stringify(configuracion)).not.toContain(secreto);
    expect(inspect(configuracion, { depth: 5 })).not.toContain(secreto);
    expect(JSON.stringify(configuracion)).toContain(TEXTO_OCULTO);
    expect(configuracion?.secreto.revelar()).toBe(secreto);
  });

  it('sin acceso configurado nadie tiene sesión', async () => {
    expect(await SIN_SESION({ cookie: 'aiw.session_token=lo-que-sea' })).toBeNull();
  });
});

describe('anotador del libro con reintentos', () => {
  /** Cliente falso: `begin` falla las veces que se pida y luego ejecuta el cuerpo. */
  function clienteQueFalla(fallos: number) {
    let llamadas = 0;
    const begin = vi.fn(async () => {
      llamadas += 1;
      if (llamadas <= fallos) throw new Error('conexión cortada');
      return undefined;
    });
    return { cliente: { begin } as unknown as postgres.Sql, begin };
  }
  const anotacion = {
    accion: ACCIONES_ACCESO.sesionIniciada,
    actorTipo: 'persona' as const,
    datos: [{ tipo: 'sesion', id: TENANT }],
  };

  it('reintenta un corte breve y acaba escribiendo', async () => {
    const { cliente, begin } = clienteQueFalla(2);
    await anotadorConBaseDeDatos(cliente, { intentos: 3, esperaMs: 1 })(TENANT, anotacion);
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it('se rinde tras los intentos y devuelve el error', async () => {
    const { cliente, begin } = clienteQueFalla(5);
    await expect(
      anotadorConBaseDeDatos(cliente, { intentos: 3, esperaMs: 1 })(TENANT, anotacion),
    ).rejects.toThrow('conexión cortada');
    expect(begin).toHaveBeenCalledTimes(3);
  });
});

describe('invitación', () => {
  it('normaliza el correo y exige organización nueva o tenant, uno de los dos', () => {
    expect(
      validarInvitacion({
        organizacion: 'Olmo',
        nombre: ' Marta ',
        correo: ' Marta@Olmo.EXAMPLE ',
      }),
    ).toMatchObject({ nombre: 'Marta', correo: 'marta@olmo.example' });
    expect(() => validarInvitacion({ nombre: 'Marta', correo: 'marta@olmo.example' })).toThrow(
      InvitacionNoValida,
    );
    expect(() =>
      validarInvitacion({
        organizacion: 'Olmo',
        tenantId: TENANT,
        nombre: 'Marta',
        correo: 'marta@olmo.example',
      }),
    ).toThrow(InvitacionNoValida);
    expect(() =>
      validarInvitacion({ tenantId: 'alfa', nombre: 'Marta', correo: 'marta@olmo.example' }),
    ).toThrow(/UUID/);
    expect(() =>
      validarInvitacion({ organizacion: 'Olmo', nombre: 'Marta', correo: 'marta' }),
    ).toThrow(/correo/);
    expect(() =>
      validarInvitacion({ organizacion: 'Olmo', nombre: ' ', correo: 'a@b.es' }),
    ).toThrow(/nombre/);
  });
});

describe('plantillas del correo', () => {
  it('el enlace va en texto y en HTML, escapado, con su caducidad', () => {
    const url = 'http://localhost:3000/api/auth/magic-link/verify?token=abc&callbackURL=%2F';
    const correo = correoDeEnlace('de@aiw.local', 'para@aiw.local', url, 15);
    expect(correo.texto).toContain(url);
    expect(correo.texto).toContain('15 minutos');
    expect(correo.html).toContain('token=abc&amp;callbackURL');
  });

  it('la invitación no deja pasar HTML en el nombre de la organización', () => {
    const correo = correoDeInvitacion(
      'de@aiw.local',
      'para@aiw.local',
      'Marta',
      '<script>x</script>',
      'http://localhost:3000/acceso',
    );
    expect(correo.html).not.toContain('<script>');
    expect(correo.texto).toContain('http://localhost:3000/acceso');
  });

  it('el correo en memoria guarda lo enviado', async () => {
    const correo = new CorreoEnMemoria();
    await correo.enviar(correoDeEnlace('de@aiw.local', 'para@aiw.local', 'http://x/', 1));
    expect(correo.ultimo?.para).toBe('para@aiw.local');
  });
});

describe('traducción entre node:http y Better Auth', () => {
  let servidor: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolver) => {
      if (servidor) servidor.close(() => resolver());
      else resolver();
    });
    servidor = undefined;
  });

  async function montar(atender: (peticion: Request) => Promise<Response>): Promise<string> {
    servidor = createServer((peticion, respuesta) => {
      void (async () => {
        try {
          await escribirRespuestaWeb(await atender(await aPeticionWeb(peticion)), respuesta);
        } catch (error) {
          respuesta.writeHead(error instanceof CuerpoDemasiadoGrande ? 413 : 500);
          respuesta.end();
        }
      })();
    });
    await new Promise<void>((resolver) => servidor?.listen(0, resolver));
    const direccion = servidor.address();
    return `http://127.0.0.1:${typeof direccion === 'object' && direccion ? direccion.port : 0}`;
  }

  it('reconoce solo las rutas de /api/auth', () => {
    expect(esRutaDeAcceso('/api/auth/get-session')).toBe(true);
    expect(esRutaDeAcceso('/api/auth')).toBe(true);
    expect(esRutaDeAcceso('/api/authx')).toBe(false);
    expect(esRutaDeAcceso('/sala')).toBe(false);
    expect(esRutaDeAcceso(undefined)).toBe(false);
  });

  it('pasa método, cabeceras y cuerpo, y devuelve cada set-cookie y la redirección', async () => {
    let vista:
      { metodo: string; cuerpo: string; origen: string | null; camino: string } | undefined;
    const base = await montar(async (peticion) => {
      vista = {
        metodo: peticion.method,
        cuerpo: await peticion.text(),
        origen: peticion.headers.get('origin'),
        camino: new URL(peticion.url).pathname,
      };
      const cabeceras = new Headers({ location: 'http://localhost:3000/panel/cuenta' });
      cabeceras.append('set-cookie', 'aiw.session_token=uno; Path=/; HttpOnly');
      cabeceras.append('set-cookie', 'aiw.otra=dos; Path=/');
      return new Response(null, { status: 302, headers: cabeceras });
    });
    const respuesta = await fetch(`${base}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.es' }),
      redirect: 'manual',
    });
    expect(respuesta.status).toBe(302);
    expect(respuesta.headers.get('location')).toBe('http://localhost:3000/panel/cuenta');
    expect(respuesta.headers.getSetCookie()).toHaveLength(2);
    expect(respuesta.headers.get('cache-control')).toBe('no-store');
    expect(vista).toEqual({
      metodo: 'POST',
      cuerpo: '{"email":"a@b.es"}',
      origen: 'http://localhost:3000',
      camino: '/api/auth/sign-in/magic-link',
    });
  });

  it('un cuerpo que pasa del tope no llega a Better Auth', async () => {
    const atender = vi.fn(async () => new Response('{}'));
    const base = await montar(atender);
    const respuesta = await fetch(`${base}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      body: 'x'.repeat(TOPE_CUERPO_ACCESO + 1),
    });
    expect(respuesta.status).toBe(413);
    expect(atender).not.toHaveBeenCalled();
  });
});

describe('registros del acceso sin credenciales', () => {
  const token = secretoDePrueba();
  const errorDeConsulta = Object.assign(
    new Error(`Failed query: select * from sesion where token = $1\nparams: ${token}`),
    { name: 'DrizzleQueryError', cause: { code: '22P02' } },
  );

  it('de un error solo queda el nombre y el código, nunca el mensaje', () => {
    const descripcion = descripcionSaneada(errorDeConsulta);
    expect(descripcion).toBe('DrizzleQueryError (22P02)');
    expect(descripcion).not.toContain(token);
    expect(descripcionSaneada('texto suelto')).toBe('error desconocido');
  });

  it('el registro de Better Auth corta los parámetros y oculta lo que parece un token', () => {
    const escrito: string[] = [];
    const espia = vi.spyOn(console, 'error').mockImplementation((texto: unknown) => {
      escrito.push(String(texto));
    });
    try {
      registroSaneado('error', errorDeConsulta.message);
      registroSaneado('warn', `cookie inválida ${token}`);
    } finally {
      espia.mockRestore();
    }
    expect(escrito.join('\n')).not.toContain(token);
    expect(escrito[1]).toContain('«oculto»');
  });
});
