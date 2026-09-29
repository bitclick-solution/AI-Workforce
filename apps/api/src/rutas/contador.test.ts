/**
 * Rutas del contador: bandera, token, sesión y caminos de error.
 *
 * Sin base de datos: el lector y la sesión se inyectan. Lo que se prueba aquí es la
 * puerta: el tenant sale de la sesión validada, y una cabecera `x-aiw-tenant` que
 * diga otra cosa no cambia nada.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import {
  BANDERA,
  VARIABLE_AUTORIZACION,
  atenderContador,
  configuracionDesdeEntorno,
  type LectorDelContador,
  type PeticionContador,
} from './contador';

const CLAVE = 'valor-de-prueba-del-contador';
const TENANT = '01929f00-0000-7000-8000-0000000000c1';
const OTRO_TENANT = '01929f00-0000-7000-8000-0000000000c9';
const CABECERA_TENANT = 'x-aiw-tenant';
const COOKIE = 'aiw.session_token=valida';

/** Sesión falsa: solo la cookie `valida` da sesión, y siempre del mismo tenant. */
const sesiones: ResolutorDeSesion = (cabeceras) =>
  Promise.resolve(
    cabeceras['cookie'] === COOKIE
      ? {
          sesionId: '01929f00-0000-7000-8000-0000000000d1',
          usuarioId: '01929f00-0000-7000-8000-0000000000d2',
          tenantId: TENANT,
          personaId: '01929f00-0000-7000-8000-0000000000d3',
          nombre: 'Propietaria',
          correo: 'propietaria@ejemplo.local',
          caducaEn: new Date(Date.now() + 3_600_000),
        }
      : null,
  );

const ENTORNO = { [BANDERA]: '1', [VARIABLE_AUTORIZACION]: CLAVE };

function lector(): LectorDelContador {
  return {
    consumo: vi.fn(async () => ({
      periodo: '2026-09-01',
      tareas: 3,
      pasos: 10,
      acciones: 14,
      costeEuros: 1.2345,
      costeModelosEuros: 1.2345,
      ultimaAnotacion: 14,
      momento: '2026-09-20T10:00:00.000Z',
    })),
    tareas: vi.fn(async (_tenantId: string, limite: number) => ({
      tareas: [],
      porEstado: { en_curso: limite > 0 ? 3 : 0 },
      total: 3,
    })),
    porPuesto: vi.fn(async () => [
      {
        puestoId: '01929f00-0000-7000-8000-0000000000c2',
        puesto: 'Contable',
        costeModelosEuros: 1.2345,
        tokensEntrada: 170_000,
        tokensSalida: 10_000,
        usos: 2,
      },
    ]),
  };
}

function peticion(parcial: Partial<PeticionContador> = {}): PeticionContador {
  return {
    metodo: 'GET',
    url: '/contador/periodo',
    cabeceras: { authorization: `Bearer ${CLAVE}`, cookie: COOKIE },
    ...parcial,
  };
}

describe('configuracionDesdeEntorno', () => {
  it('la ruta no existe sin bandera', () => {
    expect(configuracionDesdeEntorno({ [VARIABLE_AUTORIZACION]: CLAVE })).toBeUndefined();
    expect(
      configuracionDesdeEntorno({ [BANDERA]: '0', [VARIABLE_AUTORIZACION]: CLAVE }),
    ).toBeUndefined();
  });

  it('la ruta no existe sin token, ni con un token en blanco', () => {
    expect(configuracionDesdeEntorno({ [BANDERA]: '1' })).toBeUndefined();
    expect(
      configuracionDesdeEntorno({ [BANDERA]: '1', [VARIABLE_AUTORIZACION]: '   ' }),
    ).toBeUndefined();
  });

  it('con bandera y token, trae el límite de tareas por defecto', () => {
    const configuracion = configuracionDesdeEntorno(ENTORNO);
    expect(configuracion?.token).toBe(CLAVE);
    expect(configuracion?.limiteTareas).toBeGreaterThan(0);
  });

  it('un límite de tareas absurdo no rompe nada: se ignora', () => {
    const configuracion = configuracionDesdeEntorno({
      ...ENTORNO,
      AIW_CONTADOR_LIMITE_TAREAS: 'muchas',
    });
    expect(configuracion?.limiteTareas).toBeGreaterThan(0);
  });
});

describe('atenderContador', () => {
  it('sin bandera, la ruta no existe y el lector no se toca', async () => {
    const espia = lector();
    const respuesta = await atenderContador(peticion(), undefined, espia);
    expect(respuesta).toBeUndefined();
    expect(espia.consumo).not.toHaveBeenCalled();
  });

  it('una ruta ajena no es suya', async () => {
    const respuesta = await atenderContador(
      peticion({ url: '/aprobaciones/123' }),
      configuracionDesdeEntorno(ENTORNO),
      lector(),
    );
    expect(respuesta).toBeUndefined();
  });

  it('sin token responde 401 y pide autenticación, sin leer nada', async () => {
    const espia = lector();
    const respuesta = await atenderContador(
      peticion({ cabeceras: { cookie: COOKIE } }),
      configuracionDesdeEntorno(ENTORNO),
      espia,
      sesiones,
    );
    expect(respuesta?.estado).toBe(401);
    expect(respuesta?.cabeceras['www-authenticate']).toBe('Bearer');
    expect(espia.consumo).not.toHaveBeenCalled();
  });

  it('con un token que no cuadra responde 401', async () => {
    for (const autorizacion of [
      'Bearer token-equivocado',
      `Bearer ${CLAVE}x`,
      `Bearer ${CLAVE.slice(0, -1)}`,
      `Basic ${CLAVE}`,
      'Bearer',
      CLAVE,
    ]) {
      const respuesta = await atenderContador(
        peticion({ cabeceras: { authorization: autorizacion, cookie: COOKIE } }),
        configuracionDesdeEntorno(ENTORNO),
        lector(),
        sesiones,
      );
      expect(respuesta?.estado, `«${autorizacion}» no debería valer`).toBe(401);
    }
  });

  it('sin sesión responde 401 aunque la cabecera traiga un tenant, sin leer nada', async () => {
    const espia = lector();
    for (const cabeceras of [
      { authorization: `Bearer ${CLAVE}` },
      { authorization: `Bearer ${CLAVE}`, [CABECERA_TENANT]: TENANT },
      { authorization: `Bearer ${CLAVE}`, cookie: 'aiw.session_token=inventada' },
    ]) {
      const respuesta = await atenderContador(
        peticion({ cabeceras }),
        configuracionDesdeEntorno(ENTORNO),
        espia,
        sesiones,
      );
      expect(respuesta?.estado).toBe(401);
    }
    expect(espia.consumo).not.toHaveBeenCalled();
  });

  it('sin acceso configurado nadie tiene sesión: 401', async () => {
    const respuesta = await atenderContador(
      peticion(),
      configuracionDesdeEntorno(ENTORNO),
      lector(),
    );
    expect(respuesta?.estado).toBe(401);
  });

  it('el tenant es el de la sesión aunque la cabecera diga otro', async () => {
    const espia = lector();
    const respuesta = await atenderContador(
      peticion({
        cabeceras: {
          authorization: `Bearer ${CLAVE}`,
          cookie: COOKIE,
          [CABECERA_TENANT]: OTRO_TENANT,
        },
      }),
      configuracionDesdeEntorno(ENTORNO),
      espia,
      sesiones,
    );
    expect(respuesta?.estado).toBe(200);
    expect(espia.consumo).toHaveBeenCalledWith(TENANT);
    expect(espia.consumo).not.toHaveBeenCalledWith(OTRO_TENANT);
  });

  it('solo se lee: cualquier otro método responde 405', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const respuesta = await atenderContador(
        peticion({ metodo }),
        configuracionDesdeEntorno(ENTORNO),
        lector(),
        sesiones,
      );
      expect(respuesta?.estado).toBe(405);
    }
  });

  it('una ruta inventada bajo el prefijo responde 404', async () => {
    const respuesta = await atenderContador(
      peticion({ url: '/contador/lo-que-sea' }),
      configuracionDesdeEntorno(ENTORNO),
      lector(),
      sesiones,
    );
    expect(respuesta?.estado).toBe(404);
  });

  it('devuelve el consumo del periodo y no deja cachearlo', async () => {
    const espia = lector();
    const respuesta = await atenderContador(
      peticion(),
      configuracionDesdeEntorno(ENTORNO),
      espia,
      sesiones,
    );
    expect(respuesta?.estado).toBe(200);
    expect(respuesta?.cuerpo['tareas']).toBe(3);
    expect(respuesta?.cuerpo['costeModelosEuros']).toBe(1.2345);
    expect(respuesta?.cuerpo['ultimaAnotacion']).toBe(14);
    expect(respuesta?.cabeceras['cache-control']).toBe('no-store');
    expect(respuesta?.cabeceras['content-type']).toContain('application/json');
    expect(espia.consumo).toHaveBeenCalledWith(TENANT);
  });

  it('devuelve las tareas del periodo con el límite pedido', async () => {
    const espia = lector();
    const respuesta = await atenderContador(
      peticion({ url: '/contador/tareas?limite=7' }),
      configuracionDesdeEntorno(ENTORNO),
      espia,
      sesiones,
    );
    expect(respuesta?.estado).toBe(200);
    expect(respuesta?.cuerpo['total']).toBe(3);
    expect(espia.tareas).toHaveBeenCalledWith(TENANT, 7);
  });

  it('un límite absurdo no llega al lector: se usa el de la configuración', async () => {
    const espia = lector();
    const configuracion = configuracionDesdeEntorno(ENTORNO);
    for (const limite of ['0', '-5', 'todas']) {
      await atenderContador(
        peticion({ url: `/contador/tareas?limite=${limite}` }),
        configuracion,
        espia,
        sesiones,
      );
      expect(espia.tareas).toHaveBeenLastCalledWith(TENANT, configuracion?.limiteTareas);
    }
  });

  it('devuelve el coste por puesto', async () => {
    const respuesta = await atenderContador(
      peticion({ url: '/contador/coste-por-puesto' }),
      configuracionDesdeEntorno(ENTORNO),
      lector(),
      sesiones,
    );
    expect(respuesta?.estado).toBe(200);
    expect(Array.isArray(respuesta?.cuerpo['puestos'])).toBe(true);
  });

  it('ninguna respuesta lleva el token de vuelta', async () => {
    const configuracion = configuracionDesdeEntorno(ENTORNO);
    const rutas = [
      '/contador/periodo',
      '/contador/tareas',
      '/contador/coste-por-puesto',
      '/contador/no',
    ];
    for (const url of rutas) {
      for (const cabeceras of [
        { authorization: `Bearer ${CLAVE}`, cookie: COOKIE },
        { authorization: 'Bearer otro', cookie: COOKIE },
        { [CABECERA_TENANT]: 'no-es-uuid' },
      ]) {
        const respuesta = await atenderContador(
          peticion({ url, cabeceras }),
          configuracion,
          lector(),
          sesiones,
        );
        const serializada = JSON.stringify(respuesta ?? {});
        expect(serializada, `${url} devuelve el token`).not.toContain(CLAVE);
      }
    }
  });
});
