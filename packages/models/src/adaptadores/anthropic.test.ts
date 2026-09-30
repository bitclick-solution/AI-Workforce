import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import {
  iniciarServidorSimulado,
  respuestaDeRechazo,
  respuestaDeTexto,
  respuestaDeUsoDeHerramienta,
  type ServidorSimulado,
} from '../pruebas/servidor-simulado.js';
import { crearAdaptadorAnthropic, MAX_TOKENS_POR_DEFECTO } from './anthropic.js';
import { clienteSimulado } from './clientes.js';

/**
 * Palabras clave de JSON Schema que la API rechaza en `strict`/`output_config.format`
 * (ver anthropic.ts). `minItems` no está aquí a propósito: `transformJSONSchema` sí lo
 * deja pasar cuando vale 0 o 1 (el caso habitual de un array no vacío), así que no es
 * una palabra clave prohibida sin más — solo `maxItems` lo es siempre.
 */
const PALABRAS_CLAVE_NO_ADMITIDAS = [
  'minimum',
  'maximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
];

/** Recorre un JSON Schema entero —incluidos `anyOf`, `items` y `$defs`— y devuelve las claves prohibidas que encuentre. */
function palabrasClaveProhibidasEn(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(palabrasClaveProhibidasEn);
  if (valor === null || typeof valor !== 'object') return [];
  const encontradas = Object.keys(valor).filter((clave) =>
    PALABRAS_CLAVE_NO_ADMITIDAS.includes(clave),
  );
  return [...encontradas, ...Object.values(valor).flatMap(palabrasClaveProhibidasEn)];
}

/**
 * El adaptador se prueba contra un servidor que reproduce la forma de la API de
 * Mensajes, no contra Bedrock ni Vertex reales: no hay credenciales de la UE
 * todavía (ver el runbook de funciones ausentes). Lo que se comprueba aquí es la
 * lógica del adaptador — la petición que construye, cómo lee la respuesta, el
 * tratamiento del rechazo y de las salidas estructuradas —, no el transporte real.
 */
describe('crearAdaptadorAnthropic', () => {
  let servidor: ServidorSimulado | undefined;

  afterEach(async () => {
    await servidor?.cerrar();
    servidor = undefined;
  });

  it('resuelve el identificador de Vertex y lee el texto y los tokens de la respuesta', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('hola desde el simulado'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'vertex-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    expect(puerto.modelo).toBe('claude-sonnet-5');
    expect(puerto.plataforma).toBe('vertex-eu');

    const resultado = await puerto.completar({
      clasePaso: 'negocio',
      mensajes: [{ rol: 'user', contenido: '¿cuánto es 2+2?' }],
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(resultado.texto).toBe('hola desde el simulado');
    expect(resultado.tokens).toEqual({ entrada: 120, salida: 40, entradaCache: 0 });
    expect(resultado.modelo).toBe('claude-sonnet-5');

    const [peticion] = servidor.peticiones;
    const cuerpo = peticion?.cuerpo as { model: string; output_config: { effort: string } };
    expect(cuerpo.model).toBe('claude-sonnet-5');
    expect(cuerpo.output_config.effort).toBe('medium');
  });

  it('en Bedrock, sonnet5 y opus5 se sirven con la familia 4.6 y bajan xhigh a high (decisión de Jesús, 2026-09-25)', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: { conciliacion: 'xhigh' } },
    });

    expect(puerto.modelo).toBe('eu.anthropic.claude-sonnet-4-6');

    await puerto.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'x' }],
    });

    const cuerpo = servidor.peticiones[0]?.cuerpo as {
      model: string;
      output_config: { effort: string };
    };
    expect(cuerpo.model).toBe('eu.anthropic.claude-sonnet-4-6');
    expect(cuerpo.output_config.effort).toBe('high');
  });

  it('opus5 provisional no baja de high aunque la clase de paso pida menos (decisión de Jesús, 2026-09-25)', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'opus5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: { rutina: 'low' } },
    });

    expect(puerto.modelo).toBe('eu.anthropic.claude-sonnet-4-6');
    await puerto.completar({ clasePaso: 'rutina', mensajes: [{ rol: 'user', contenido: 'x' }] });

    const cuerpo = servidor.peticiones[0]?.cuerpo as { output_config: { effort: string } };
    expect(cuerpo.output_config.effort).toBe('high');
  });

  it('sonnet5 provisional no lleva el suelo de esfuerzo alto: solo opus5 lo necesita', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: { rutina: 'low' } },
    });

    await puerto.completar({ clasePaso: 'rutina', mensajes: [{ rol: 'user', contenido: 'x' }] });

    const cuerpo = servidor.peticiones[0]?.cuerpo as { output_config: { effort: string } };
    expect(cuerpo.output_config.effort).toBe('low');
  });

  it('pide pensamiento adaptativo y el esfuerzo de la clase de paso, salvo en Haiku 4.5', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puertoSonnet = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'vertex-eu',
      configuracion: { esfuerzoPorClasePaso: { conciliacion: 'high' } },
    });
    await puertoSonnet.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'x' }],
    });

    const puertoHaiku = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'haiku45',
      plataforma: 'vertex-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });
    await puertoHaiku.completar({
      clasePaso: 'rutina',
      mensajes: [{ rol: 'user', contenido: 'x' }],
    });

    const [conSonnet, conHaiku] = servidor.peticiones.map(
      (p) => p.cuerpo as { thinking?: unknown; output_config: { effort?: string } },
    );
    expect(conSonnet?.thinking).toEqual({ type: 'adaptive' });
    expect(conSonnet?.output_config.effort).toBe('high');

    expect(conHaiku?.thinking).toBeUndefined();
    expect(conHaiku?.output_config.effort).toBeUndefined();
  });

  it('trata el rechazo del clasificador como resultado, no como excepción (ADR-018)', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeRechazo('cyber', 'motivo de prueba'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'opus5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    const resultado = await puerto.completar({
      clasePaso: 'decision_escritura',
      mensajes: [{ rol: 'user', contenido: 'emite el pago' }],
    });

    expect(resultado.tipo).toBe('rechazo');
    if (resultado.tipo !== 'rechazo') throw new Error('se esperaba rechazo');
    expect(resultado.categoria).toBe('cyber');
    expect(resultado.explicacion).toBe('motivo de prueba');
    expect(resultado.tokens.entrada).toBeGreaterThan(0);
  });

  it('valida la salida estructurada contra el esquema y estricto en las herramientas', async () => {
    const esquema = z.object({ decision: z.enum(['aprobar', 'rechazar']), motivo: z.string() });
    servidor = await iniciarServidorSimulado(
      respuestaDeTexto(JSON.stringify({ decision: 'aprobar', motivo: 'cuadra' })),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'opus5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    const resultado = await puerto.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'concilia' }],
      esquemaSalida: esquema,
      herramientas: [
        {
          nombre: 'buscar_movimiento',
          descripcion: 'Busca un movimiento bancario por importe',
          esquemaEntrada: z.object({ importeCentimos: z.number().int() }),
        },
      ],
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(resultado.salida).toEqual({ decision: 'aprobar', motivo: 'cuadra' });

    const [peticion] = servidor.peticiones;
    const cuerpo = peticion?.cuerpo as {
      output_config: { format: { type: string } };
      tools: { strict: boolean }[];
    };
    expect(cuerpo.output_config.format.type).toBe('json_schema');
    expect(cuerpo.tools[0]?.strict).toBe(true);
  });

  it('rechaza una salida que no cumple el esquema pedido, en vez de dejarla pasar', async () => {
    const esquema = z.object({ decision: z.enum(['aprobar', 'rechazar']) });
    servidor = await iniciarServidorSimulado(
      respuestaDeTexto(JSON.stringify({ decision: 'tal_vez' })),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    await expect(
      puerto.completar({
        clasePaso: 'negocio',
        mensajes: [{ rol: 'user', contenido: 'x' }],
        esquemaSalida: esquema,
      }),
    ).rejects.toThrow(/no cumple el esquema/);
  });

  it('usa el máximo de tokens por defecto cuando la petición no lo fija', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });
    await puerto.completar({ clasePaso: 'negocio', mensajes: [{ rol: 'user', contenido: 'x' }] });
    const cuerpo = servidor.peticiones[0]?.cuerpo as { max_tokens: number };
    expect(cuerpo.max_tokens).toBe(MAX_TOKENS_POR_DEFECTO);
  });

  it('anula el identificador calculado cuando Bedrock exige un perfil de inferencia', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
      identificadorModelo: 'eu.anthropic.claude-sonnet-5',
    });

    expect(puerto.modelo).toBe('eu.anthropic.claude-sonnet-5');
    await puerto.completar({ clasePaso: 'negocio', mensajes: [{ rol: 'user', contenido: 'x' }] });
    const cuerpo = servidor.peticiones[0]?.cuerpo as { model: string };
    expect(cuerpo.model).toBe('eu.anthropic.claude-sonnet-5');
  });

  it('un identificador vacío no anula nada: la variable de la CI sin definir llega como cadena vacía', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('ok'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: { conciliacion: 'xhigh' } },
      identificadorModelo: '',
    });

    expect(puerto.modelo).toBe('eu.anthropic.claude-sonnet-4-6');
    await puerto.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'x' }],
    });

    const cuerpo = servidor.peticiones[0]?.cuerpo as {
      model: string;
      output_config: { effort: string };
    };
    expect(cuerpo.model).toBe('eu.anthropic.claude-sonnet-4-6');
    // Sigue siendo el sustituto provisional: xhigh baja a high como sin anulación.
    expect(cuerpo.output_config.effort).toBe('high');
  });
});

/**
 * Palabras clave que la API rechaza con 400 en `strict`/`output_config.format`
 * (encontrado el 28-9 al ejecutar la prueba de integración de Bedrock UE en `main`,
 * PR #32): `z.number().int()` las añade aunque el esquema Zod no las pida
 * explícitamente (los límites del entero seguro de JavaScript), así que hace falta
 * un esquema con restricciones reales — no una tubería vacía — para reproducir el
 * fallo. Ver el comentario de cabecera de `anthropic.ts`.
 */
describe('esquemas estrictos: quita las palabras clave no admitidas y valida al recibir', () => {
  let servidor: ServidorSimulado | undefined;

  afterEach(async () => {
    await servidor?.cerrar();
    servidor = undefined;
  });

  const ESQUEMA_ANIDADO = z.object({
    importeCentimos: z.number().int().min(1).max(1_000_00),
    etiquetas: z.array(z.string().min(1).max(20)).min(1).max(5),
    detalle: z.union([
      z.object({ tipo: z.literal('exacto'), diferenciaCentimos: z.literal(0) }),
      z.object({
        tipo: z.literal('aproximado'),
        diferenciaCentimos: z.number().min(-100).max(100),
      }),
    ]),
  });

  it('quita minimum/maximum/minLength/maxLength de la herramienta y de la salida estructurada, en todos los niveles', async () => {
    servidor = await iniciarServidorSimulado(
      respuestaDeTexto(JSON.stringify({ decision: 'aprobar' })),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    await puerto.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'concilia' }],
      esquemaSalida: z.object({ decision: z.enum(['aprobar', 'rechazar']) }),
      herramientas: [
        {
          nombre: 'buscar_movimiento',
          descripcion: 'Busca un movimiento bancario acotado',
          esquemaEntrada: ESQUEMA_ANIDADO,
        },
      ],
    });

    const cuerpo = servidor.peticiones[0]?.cuerpo as {
      tools: { input_schema: unknown }[];
      output_config: { format?: { schema: unknown } };
    };
    expect(palabrasClaveProhibidasEn(cuerpo.tools[0]?.input_schema)).toEqual([]);
    expect(palabrasClaveProhibidasEn(cuerpo.output_config.format?.schema)).toEqual([]);
  });

  it('valida la entrada de una llamada a herramienta contra el esquema Zod original y la expone en llamadasHerramientas', async () => {
    const entrada = {
      importeCentimos: 500,
      etiquetas: ['factura'],
      detalle: { tipo: 'exacto', diferenciaCentimos: 0 },
    };
    servidor = await iniciarServidorSimulado(
      respuestaDeUsoDeHerramienta('buscar_movimiento', entrada),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    const resultado = await puerto.completar({
      clasePaso: 'conciliacion',
      mensajes: [{ rol: 'user', contenido: 'busca el movimiento' }],
      herramientas: [
        {
          nombre: 'buscar_movimiento',
          descripcion: 'Busca un movimiento bancario acotado',
          esquemaEntrada: ESQUEMA_ANIDADO,
        },
      ],
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') return;
    expect(resultado.llamadasHerramientas).toEqual([
      { id: 'toolu_simulado_01', nombre: 'buscar_movimiento', entrada },
    ]);
  });

  it('rechaza una entrada de herramienta que no cumple su esquema, aunque la API ya no lo comprueba', async () => {
    servidor = await iniciarServidorSimulado(
      respuestaDeUsoDeHerramienta('buscar_movimiento', {
        // La API, sin minimum/maximum en el esquema que viajó, ya no rechaza esto: lo
        // vuelve a comprobar el adaptador contra el esquema Zod original.
        importeCentimos: -5,
        etiquetas: ['factura'],
        detalle: { tipo: 'exacto', diferenciaCentimos: 0 },
      }),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    await expect(
      puerto.completar({
        clasePaso: 'conciliacion',
        mensajes: [{ rol: 'user', contenido: 'busca el movimiento' }],
        herramientas: [
          {
            nombre: 'buscar_movimiento',
            descripcion: 'Busca un movimiento bancario acotado',
            esquemaEntrada: ESQUEMA_ANIDADO,
          },
        ],
      }),
    ).rejects.toThrow(/no cumple su esquema/);
  });

  it('lanza si el modelo pide una herramienta que no estaba declarada en la petición', async () => {
    servidor = await iniciarServidorSimulado(
      respuestaDeUsoDeHerramienta('herramienta_fantasma', { x: 1 }),
    );
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    await expect(
      puerto.completar({
        clasePaso: 'conciliacion',
        mensajes: [{ rol: 'user', contenido: 'x' }],
        herramientas: [
          {
            nombre: 'buscar_movimiento',
            descripcion: 'Busca un movimiento bancario acotado',
            esquemaEntrada: ESQUEMA_ANIDADO,
          },
        ],
      }),
    ).rejects.toThrow(/no estaba entre las declaradas/);
  });
});
