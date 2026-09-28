/**
 * Panel del contador: bandera, lectura, formato y caminos de error.
 *
 * Sin red y sin API: el buscador se inyecta. Lo que se prueba es que el panel no se
 * enciende sin bandera, que no manda a la API lo que no puede atender y que cuando
 * la API falla lo dice en vez de pintar ceros.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  BANDERA_PANEL,
  configuracionPanel,
  esRancio,
  etiquetaTareas,
  formatearEntero,
  formatearEuros,
  leerContador,
  panelActivo,
  type ConfiguracionPanel,
} from './contador';

const CLAVE = 'valor-de-prueba-del-panel';
const COOKIE = 'aiw.session_token=de-la-prueba';

const ENTORNO = {
  [BANDERA_PANEL]: '1',
  AIW_API_URL: 'http://127.0.0.1:3002',
  AIW_CONTADOR_TOKEN: CLAVE,
};

const CONSUMO = {
  periodo: '2026-09-01',
  tareas: 4,
  pasos: 12,
  acciones: 19,
  costeEuros: 0.9,
  costeModelosEuros: 0.9,
  ultimaAnotacion: 19,
  momento: '2026-09-20T10:00:00.000Z',
};

function respuesta(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => cuerpo,
  } as Response;
}

function buscadorFeliz() {
  return vi.fn(async (url: string, _opciones: { headers: Record<string, string> }) => {
    if (url.endsWith('/contador/periodo')) return respuesta(CONSUMO);
    if (url.endsWith('/contador/tareas')) {
      return respuesta({
        tareas: [
          {
            tareaId: '01929f00-0000-7000-8000-0000000000d2',
            puesto: 'Contable',
            estado: 'en_curso',
            origen: 'sala',
            creadoEn: '2026-09-20T09:00:00.000Z',
            costeModelosEuros: 0.9,
            usos: 2,
            delegaciones: 1,
          },
        ],
        porEstado: { en_curso: 4 },
      });
    }
    return respuesta({ puestos: [] });
  });
}

describe('bandera del panel', () => {
  it('apagada o ausente, el panel no existe', () => {
    expect(panelActivo({})).toBe(false);
    expect(panelActivo({ [BANDERA_PANEL]: '0' })).toBe(false);
    expect(configuracionPanel({ ...ENTORNO, [BANDERA_PANEL]: '0' })).toBeUndefined();
  });

  it('encendida pero sin token o sin API, tampoco', () => {
    expect(configuracionPanel({ ...ENTORNO, AIW_CONTADOR_TOKEN: '' })).toBeUndefined();
    expect(configuracionPanel({ ...ENTORNO, AIW_API_URL: '  ' })).toBeUndefined();
  });

  it('con todo en su sitio, la dirección de la API pierde la barra final y no hay tenant', () => {
    const configuracion = configuracionPanel({
      ...ENTORNO,
      AIW_API_URL: 'http://api:3002/',
      AIW_PANEL_TENANT: '01929f00-0000-7000-8000-0000000000d1',
    });
    expect(configuracion).toEqual({ apiUrl: 'http://api:3002', token: CLAVE });
  });
});

describe('leerContador', () => {
  const configuracion: ConfiguracionPanel = {
    apiUrl: 'http://127.0.0.1:3002',
    token: CLAVE,
  };

  it('lee las tres rutas con el token y la cookie de sesión, sin tenant', async () => {
    const buscar = buscadorFeliz();
    const datos = await leerContador(configuracion, buscar, COOKIE);
    expect(datos.consumo.tareas).toBe(4);
    expect(datos.tareas[0]?.delegaciones).toBe(1);
    expect(datos.porEstado['en_curso']).toBe(4);
    expect(datos.porPuesto).toEqual([]);
    expect(buscar).toHaveBeenCalledTimes(3);
    for (const [, opciones] of buscar.mock.calls) {
      expect(opciones.headers['authorization']).toBe(`Bearer ${CLAVE}`);
      expect(opciones.headers['cookie']).toBe(COOKIE);
      expect(opciones.headers['x-aiw-tenant']).toBeUndefined();
    }
  });

  it('un 401 se cuenta como error, no como panel a cero', async () => {
    const buscar = vi.fn(async () => respuesta({ error: 'no' }, 401));
    await expect(leerContador(configuracion, buscar, COOKIE)).rejects.toThrow(/respondió 401/);
  });

  it('un 500 también', async () => {
    const buscar = vi.fn(async () => respuesta({ error: 'no' }, 500));
    await expect(leerContador(configuracion, buscar, COOKIE)).rejects.toThrow(/respondió 500/);
  });

  it('si la API no responde, el mensaje no lleva su dirección interna', async () => {
    const buscar = vi.fn(async () => {
      throw new Error('ECONNREFUSED http://api-interna:3002');
    });
    await expect(leerContador(configuracion, buscar, COOKIE)).rejects.toThrow(
      'La API del contador no responde.',
    );
    await expect(leerContador(configuracion, buscar, COOKIE)).rejects.not.toThrow(/api-interna/);
  });
});

/**
 * El separador de miles depende de los datos de idioma que traiga el Node que
 * ejecute esto: con ICU completo son `1.234`, y con el ICU reducido de algunas
 * imágenes, `1234`. Las pruebas comprueban lo que sí es del panel —coma decimal,
 * símbolo del euro, número de decimales y singular— y dejan el agrupamiento
 * opcional, en vez de atarse a la máquina donde se escribieron.
 */
const MILES = '[.\\s  ]?';

describe('formato en español', () => {
  it('los euros llevan su símbolo y hasta cuatro decimales', () => {
    expect(formatearEuros(1234.5)).toMatch(new RegExp(`1${MILES}234,50`));
    expect(formatearEuros(1234.5)).toContain('€');
    expect(formatearEuros(0.0741)).toContain('0,0741');
    expect(formatearEuros(Number.NaN)).toContain('0,00');
  });

  it('los enteros no llevan decimales y sí agrupan si el idioma lo permite', () => {
    expect(formatearEntero(1_234_567)).toMatch(new RegExp(`^1${MILES}234${MILES}567$`));
    expect(formatearEntero(3.9)).toBe('3');
    expect(formatearEntero(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('una tarea no son «1 tareas»', () => {
    expect(etiquetaTareas(1)).toBe('1 tarea');
    expect(etiquetaTareas(0)).toBe('0 tareas');
    expect(etiquetaTareas(2_000)).toMatch(new RegExp(`^2${MILES}000 tareas$`));
  });
});

describe('esRancio', () => {
  const momento = '2026-09-20T10:00:00.000Z';
  const ahora = Date.parse(momento);

  it('lo recién leído no es rancio', () => {
    expect(esRancio(momento, ahora + 1_000)).toBe(false);
  });

  it('pasada la tolerancia, sí', () => {
    expect(esRancio(momento, ahora + 31_000)).toBe(true);
  });

  it('un reloj adelantado también cuenta como rancio', () => {
    expect(esRancio(momento, ahora - 60_000)).toBe(true);
  });

  it('una marca que no es fecha se trata como rancia, no como buena', () => {
    expect(esRancio('ahora mismo', ahora)).toBe(true);
  });
});
