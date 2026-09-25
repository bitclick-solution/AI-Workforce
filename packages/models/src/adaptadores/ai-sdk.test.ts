import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { crearAdaptadorAiSdk } from './ai-sdk.js';

/**
 * El proveedor determinista de la integración continua (ADR-002, ADR-017) es
 * exactamente esto: `MockLanguageModelV4` de `ai/test`, el modelo de pruebas del AI
 * SDK. No hace falta un servidor simulado propio para esta ruta porque el AI SDK ya
 * trae el suyo, documentado y mantenido junto al SDK.
 */
describe('crearAdaptadorAiSdk', () => {
  it('devuelve el texto y los tokens del modelo determinista', async () => {
    const modelo = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'respuesta determinista' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 30, noCache: 30, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 12, text: 12, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const puerto = crearAdaptadorAiSdk(modelo, { modelo: 'ci-determinista' });

    expect(puerto.plataforma).toBe('ai-sdk');
    const resultado = await puerto.completar({
      clasePaso: 'rutina',
      mensajes: [{ rol: 'user', contenido: 'hola' }],
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(resultado.texto).toBe('respuesta determinista');
    expect(resultado.tokens).toEqual({ entrada: 30, salida: 12, entradaCache: 0 });
  });

  it('valida la salida estructurada contra el esquema pedido', async () => {
    const modelo = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ clasificacion: 'cobrado' }) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const puerto = crearAdaptadorAiSdk(modelo, { modelo: 'ci-determinista' });

    const resultado = await puerto.completar({
      clasePaso: 'enrutado',
      mensajes: [{ rol: 'user', contenido: 'clasifica' }],
      esquemaSalida: z.object({ clasificacion: z.enum(['cobrado', 'pendiente']) }),
    });

    expect(resultado.tipo).toBe('ok');
    if (resultado.tipo !== 'ok') throw new Error('se esperaba ok');
    expect(resultado.salida).toEqual({ clasificacion: 'cobrado' });
  });

  it('trata el filtro de contenido como el rechazo del clasificador', async () => {
    const modelo = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [],
        finishReason: { unified: 'content-filter', raw: undefined },
        usage: {
          inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 0, text: 0, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const puerto = crearAdaptadorAiSdk(modelo, { modelo: 'mistral-large-latest' });

    const resultado = await puerto.completar({
      clasePaso: 'rutina',
      mensajes: [{ rol: 'user', contenido: 'x' }],
    });
    expect(resultado.tipo).toBe('rechazo');
  });
});
