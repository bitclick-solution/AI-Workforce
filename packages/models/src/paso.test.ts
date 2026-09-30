import { describe, expect, it } from 'vitest';

import { Enrutador, ProveedorNoRegistrado, enrutadorDePrueba } from './enrutado.js';
import {
  guionCobros,
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  redactarNotas,
} from './guiones/cobros.js';
import { componerPrompt, crearCacheDePrompts } from './cache-de-prompts.js';
import { darPasoDeModelo, herramientasParaElModelo } from './paso.js';
import { MODELO_PRUEBA, PROVEEDOR_PRUEBA, crearProveedorDePrueba } from './proveedor-prueba.js';
import { TrazasEnMemoria } from './trazas.js';
import { tokensParaElContador } from './uso.js';

const ATRIBUTOS = {
  tenantId: '0199e1a0-0000-7000-8000-000000000001',
  puestoId: '0199e1a0-0000-7000-8000-000000000002',
  versionPuestoId: '0199e1a0-0000-7000-8000-000000000003',
  tareaId: '0199e1a0-0000-7000-8000-000000000004',
  proveedor: PROVEEDOR_PRUEBA,
  modelo: MODELO_PRUEBA,
};

const CATALOGO = [
  {
    nombre: HERRAMIENTA_LISTAR,
    descripcion: 'Devuelve las facturas vencidas.',
    esquemaEntrada: { type: 'object', properties: {} },
  },
  {
    nombre: HERRAMIENTA_NOTA,
    descripcion: 'Escribe una nota de seguimiento.',
    esquemaEntrada: {
      type: 'object',
      properties: { factura_id: { type: 'string' }, texto: { type: 'string' } },
      required: ['factura_id', 'texto'],
    },
  },
];

const FACTURAS = {
  facturas: [
    {
      id: 'inv-0001',
      numero: 'F-2026-0001',
      cliente: { id: 'cli-001', nombre: 'Talleres' },
      importe_pendiente: 1240.5,
      moneda: 'EUR',
      dias_vencida: 37,
    },
    {
      id: 'inv-0002',
      numero: 'F-2026-0002',
      cliente: { id: 'cli-002', nombre: 'Panadería' },
      importe_pendiente: 318,
      moneda: 'EUR',
      dias_vencida: 20,
    },
  ],
  total: 2,
};

describe('paso de modelo · el bucle se queda en casa', () => {
  it('las herramientas se ofrecen sin función que las ejecute', () => {
    const conjunto = herramientasParaElModelo(CATALOGO);
    expect(Object.keys(conjunto)).toEqual([HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA]);
    for (const herramienta of Object.values(conjunto)) {
      expect(herramienta.execute).toBeUndefined();
    }
  });

  it('devuelve la llamada que pide el modelo sin ejecutarla', async () => {
    const trazas = new TrazasEnMemoria();
    const paso = await darPasoDeModelo({
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
      sistema: 'Eres el agente de Cobros.',
      mensajes: [{ role: 'user', content: 'Haz el seguimiento de cobros de hoy.' }],
      herramientas: CATALOGO,
      atributos: ATRIBUTOS,
      trazas,
    });

    expect(paso.llamadas).toHaveLength(1);
    expect(paso.llamadas[0]?.herramienta).toBe(HERRAMIENTA_LISTAR);
    expect(paso.motivoFin).toBe('tool-calls');
    expect(paso.tokens).toEqual({ entrada: 640, salida: 60, entradaCache: 0 });
  });

  it('con el resultado de la lista propone una nota por factura vencida', async () => {
    const paso = await darPasoDeModelo({
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
      sistema: 'Eres el agente de Cobros.',
      mensajes: [
        { role: 'user', content: 'Haz el seguimiento de cobros de hoy.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'prueba-1-1',
              toolName: HERRAMIENTA_LISTAR,
              input: {},
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'prueba-1-1',
              toolName: HERRAMIENTA_LISTAR,
              output: { type: 'text', value: JSON.stringify(FACTURAS) },
            },
          ],
        },
      ],
      herramientas: CATALOGO,
      atributos: ATRIBUTOS,
    });

    expect(paso.llamadas).toHaveLength(2);
    expect(paso.llamadas.map((l) => l.argumentos['factura_id'])).toEqual(['inv-0001', 'inv-0002']);
  });

  it('la traza lleva tenant, puesto, tarea y versión, y ningún argumento', async () => {
    const trazas = new TrazasEnMemoria();
    await darPasoDeModelo({
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
      sistema: 'Eres el agente de Cobros.',
      mensajes: [{ role: 'user', content: 'Adelante.' }],
      herramientas: CATALOGO,
      atributos: ATRIBUTOS,
      trazas,
    });

    const traza = trazas.ultima;
    expect(traza).toMatchObject({
      tenantId: ATRIBUTOS.tenantId,
      puestoId: ATRIBUTOS.puestoId,
      tareaId: ATRIBUTOS.tareaId,
      versionPuestoId: ATRIBUTOS.versionPuestoId,
      herramientasOfrecidas: 2,
      herramientasPedidas: [HERRAMIENTA_LISTAR],
    });
    expect(JSON.stringify(traza)).not.toContain('Adelante');
  });

  it('el proveedor de prueba es determinista: dos ejecuciones iguales dan lo mismo', async () => {
    const peticion = {
      sistema: 'Eres el agente de Cobros.',
      mensajes: [{ role: 'user' as const, content: 'Haz el seguimiento.' }],
      herramientas: CATALOGO,
      atributos: ATRIBUTOS,
    };
    const primera = await darPasoDeModelo({
      ...peticion,
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
    });
    const segunda = await darPasoDeModelo({
      ...peticion,
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
    });

    expect(segunda.llamadas).toEqual(primera.llamadas);
    expect(segunda.texto).toBe(primera.texto);
    expect(segunda.tokens).toEqual(primera.tokens);
  });

  it('sin la herramienta de escritura, responde con agregados y no la pide', async () => {
    const paso = await darPasoDeModelo({
      modelo: crearProveedorDePrueba({ guion: guionCobros }),
      sistema: 'Eres el agente de Cobros.',
      mensajes: [
        { role: 'user', content: 'Haz el seguimiento.' },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 'x', toolName: HERRAMIENTA_LISTAR, input: {} },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'x',
              toolName: HERRAMIENTA_LISTAR,
              output: { type: 'text', value: JSON.stringify(FACTURAS) },
            },
          ],
        },
      ],
      herramientas: CATALOGO.slice(0, 1),
      atributos: ATRIBUTOS,
    });

    expect(paso.llamadas).toHaveLength(0);
    expect(paso.texto).toMatch(/facturas? vencidas? por/);
  });
});

describe('uso del proveedor · tokens que cobra el contador', () => {
  it('resta los tokens de caché leída de la entrada facturable', () => {
    expect(
      tokensParaElContador({
        inputTokens: { total: 1000, cacheRead: 600, cacheWrite: 0 },
        outputTokens: { total: 120 },
      }),
    ).toEqual({ entrada: 400, salida: 120, entradaCache: 600 });
  });

  it('respeta el desglose del proveedor cuando lo da', () => {
    expect(
      tokensParaElContador({
        inputTokens: { total: 1000, noCache: 300, cacheRead: 600, cacheWrite: 100 },
        outputTokens: { total: 50 },
      }),
    ).toEqual({ entrada: 400, salida: 50, entradaCache: 600 });
  });

  it('un uso sin informar es cero y no un precio inventado', () => {
    expect(tokensParaElContador(undefined)).toEqual({ entrada: 0, salida: 0, entradaCache: 0 });
  });
});

describe('enrutado de modelos', () => {
  it('resuelve el proveedor y el modelo del puesto', () => {
    const enrutador = enrutadorDePrueba(guionCobros);
    const resuelto = enrutador.resolver({ proveedor: 'prueba', modelo: 'deterministico' });
    expect(resuelto.proveedor).toBe('prueba');
    expect(resuelto.modelo.modelId).toBe('deterministico');
  });

  it('cae a la alternativa cuando el principal no está registrado', () => {
    const enrutador = enrutadorDePrueba(guionCobros);
    const resuelto = enrutador.resolver({
      proveedor: 'anthropic',
      modelo: 'claude',
      alternativas: [{ proveedor: 'prueba', modelo: 'suplente' }],
    });
    expect(resuelto.proveedor).toBe('prueba');
    expect(resuelto.modeloId).toBe('suplente');
  });

  it('falla diciendo qué proveedores hay en vez de cambiar de modelo en silencio', () => {
    expect(() => new Enrutador().resolver({ proveedor: 'openai', modelo: 'x' })).toThrow(
      ProveedorNoRegistrado,
    );
  });
});

describe('caché del prompt de la versión de puesto', () => {
  it('compone una vez por versión y reutiliza después', () => {
    const cache = crearCacheDePrompts();
    let compuestos = 0;
    const componer = () => {
      compuestos += 1;
      return componerPrompt({ prompt: 'Eres el agente.', brandVoice: { tratamiento: 'tu' } });
    };

    const primero = cache.obtener('version-1', componer);
    const segundo = cache.obtener('version-1', componer);

    expect(compuestos).toBe(1);
    expect(segundo).toBe(primero);
    expect(cache.aciertos).toBe(1);
    expect(cache.fallos).toBe(1);
  });

  it('una versión distinta es otra clave: no hay invalidación que programar', () => {
    const cache = crearCacheDePrompts();
    cache.obtener('version-1', () => 'uno');
    expect(cache.obtener('version-2', () => 'dos')).toBe('dos');
  });

  it('expulsa la entrada más antigua al llenarse', () => {
    const cache = crearCacheDePrompts({ maximo: 2 });
    cache.obtener('a', () => 'a');
    cache.obtener('b', () => 'b');
    cache.obtener('c', () => 'c');
    let recompuesto = false;
    cache.obtener('a', () => {
      recompuesto = true;
      return 'a';
    });
    expect(recompuesto).toBe(true);
  });

  it('el prompt compuesto lleva el orden fijo: quién eres, cómo hablas, qué sabes', () => {
    const sistema = componerPrompt({
      prompt: 'Eres el agente de Cobros.',
      brandVoice: { tono: 'cercano', tratamiento: 'tu', prohibiciones: ['amenazar'] },
      memoria: ['Talleres paga a 60 días.'],
    });
    expect(sistema.indexOf('Eres el agente')).toBeLessThan(sistema.indexOf('Cómo hablas'));
    expect(sistema.indexOf('Cómo hablas')).toBeLessThan(sistema.indexOf('Lo que ya sabes'));
    expect(sistema).toContain('Trata de tú.');
  });

  it('el índice de habilidades entra tras la memoria y sin cuerpo', () => {
    const sistema = componerPrompt({
      prompt: 'Eres el agente de Cobros.',
      memoria: ['Talleres paga a 60 días.'],
      habilidades: ['cobros.antiguedad-de-cobros: facturas vencidas por tramo'],
    });
    expect(sistema.indexOf('Lo que ya sabes')).toBeLessThan(
      sistema.indexOf('Habilidades que puedes cargar'),
    );
    expect(sistema).toContain('cobros.antiguedad-de-cobros: facturas vencidas por tramo');
  });

  it('sin habilidades congeladas, el prompt no cambia respecto a hoy', () => {
    const sin = componerPrompt({ prompt: 'Eres el agente.', memoria: ['x'] });
    const conVacio = componerPrompt({ prompt: 'Eres el agente.', memoria: ['x'], habilidades: [] });
    expect(conVacio).toBe(sin);
    expect(sin).not.toContain('Habilidades que puedes cargar');
  });
});

describe('redacción de las notas de cobro', () => {
  it('una nota por factura, con el número y el importe dentro', () => {
    const notas = redactarNotas(FACTURAS.facturas);
    expect(notas).toHaveLength(2);
    expect(notas[0]?.factura_id).toBe('inv-0001');
    expect(notas[0]?.texto).toContain('F-2026-0001');
    expect(notas[0]?.texto).toContain('1240.50 €');
  });
});
