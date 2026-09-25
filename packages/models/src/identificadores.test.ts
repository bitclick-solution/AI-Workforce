import { describe, expect, it } from 'vitest';

import { esProvisional, identificadorDeModelo, nombreCanonico } from './identificadores.js';

describe('identificadorDeModelo', () => {
  it('lleva el prefijo anthropic. en Bedrock, y Haiku 4.5 no tiene sustituto provisional', () => {
    expect(identificadorDeModelo('haiku45', 'bedrock-eu')).toBe('anthropic.claude-haiku-4-5');
  });

  it('va desnudo, sin fecha, en Vertex y en primera parte (ADR-018)', () => {
    expect(identificadorDeModelo('opus5', 'vertex-eu')).toBe('claude-opus-5');
    expect(identificadorDeModelo('opus5', 'primera-parte')).toBe('claude-opus-5');
    expect(identificadorDeModelo('sonnet5', 'vertex-eu')).toBe('claude-sonnet-5');
    expect(identificadorDeModelo('opus5', 'vertex-eu')).not.toMatch(/\d{8}/);
  });

  it('rechaza ai-sdk: no tiene identificador de Anthropic', () => {
    expect(() => identificadorDeModelo('sonnet5', 'ai-sdk')).toThrow(/ai-sdk/);
  });

  it('el nombre canónico es el objetivo del ADR-018, no la sustitución provisional', () => {
    expect(nombreCanonico('sonnet5')).toBe('claude-sonnet-5');
    expect(nombreCanonico('opus5')).toBe('claude-opus-5');
  });

  describe('sustitución provisional en Bedrock (decisión de Jesús, 2026-09-25, revisada el mismo día)', () => {
    it('opus5 y sonnet5 se sirven los dos con Sonnet 4.6 en Bedrock: sin cuota de ningún Opus', () => {
      expect(identificadorDeModelo('opus5', 'bedrock-eu')).toBe('anthropic.claude-sonnet-4-6');
      expect(identificadorDeModelo('sonnet5', 'bedrock-eu')).toBe('anthropic.claude-sonnet-4-6');
    });

    it('marca opus5 y sonnet5 como provisionales solo en Bedrock', () => {
      expect(esProvisional('opus5', 'bedrock-eu')).toBe(true);
      expect(esProvisional('sonnet5', 'bedrock-eu')).toBe(true);
      expect(esProvisional('opus5', 'vertex-eu')).toBe(false);
      expect(esProvisional('opus5', 'primera-parte')).toBe(false);
    });

    it('haiku45 no tiene sustitución provisional en ninguna plataforma: ya está disponible', () => {
      expect(esProvisional('haiku45', 'bedrock-eu')).toBe(false);
      expect(identificadorDeModelo('haiku45', 'vertex-eu')).toBe('claude-haiku-4-5');
    });
  });
});
