import { describe, expect, it } from 'vitest';

import { identificadorDeModelo, nombreCanonico } from './identificadores.js';

describe('identificadorDeModelo', () => {
  it('lleva el prefijo anthropic. en Bedrock', () => {
    expect(identificadorDeModelo('opus5', 'bedrock-eu')).toBe('anthropic.claude-opus-5');
    expect(identificadorDeModelo('sonnet5', 'bedrock-eu')).toBe('anthropic.claude-sonnet-5');
    expect(identificadorDeModelo('haiku45', 'bedrock-eu')).toBe('anthropic.claude-haiku-4-5');
  });

  it('va desnudo, sin fecha, en Vertex y en primera parte (ADR-018)', () => {
    expect(identificadorDeModelo('opus5', 'vertex-eu')).toBe('claude-opus-5');
    expect(identificadorDeModelo('opus5', 'primera-parte')).toBe('claude-opus-5');
    expect(identificadorDeModelo('opus5', 'vertex-eu')).not.toMatch(/\d{8}/);
  });

  it('rechaza ai-sdk: no tiene identificador de Anthropic', () => {
    expect(() => identificadorDeModelo('sonnet5', 'ai-sdk')).toThrow(/ai-sdk/);
  });

  it('el nombre canónico es el mismo que se registra en el contador', () => {
    expect(nombreCanonico('sonnet5')).toBe('claude-sonnet-5');
  });
});
