import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';

import {
  iniciarServidorSimulado,
  respuestaDeRechazo,
  respuestaDeTexto,
  type ServidorSimulado,
} from '../pruebas/servidor-simulado.js';
import { crearAdaptadorAnthropic, MAX_TOKENS_POR_DEFECTO } from './anthropic.js';
import { clienteSimulado } from './clientes.js';

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

  it('resuelve el identificador de Bedrock y lee el texto y los tokens de la respuesta', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('hola desde el simulado'));
    const puerto = crearAdaptadorAnthropic(clienteSimulado(servidor.url), {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    expect(puerto.modelo).toBe('anthropic.claude-sonnet-5');
    expect(puerto.plataforma).toBe('bedrock-eu');

    const resultado = await puerto.completar({
      clasePaso: 'negocio',
      mensajes: [{ rol: 'user', contenido: '¿cuánto es 2+2?' }],
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(resultado.texto).toBe('hola desde el simulado');
    expect(resultado.tokens).toEqual({ entrada: 120, salida: 40, entradaCache: 0 });
    expect(resultado.modelo).toBe('anthropic.claude-sonnet-5');

    const [peticion] = servidor.peticiones;
    const cuerpo = peticion?.cuerpo as { model: string; output_config: { effort: string } };
    expect(cuerpo.model).toBe('anthropic.claude-sonnet-5');
    expect(cuerpo.output_config.effort).toBe('medium');
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
});
