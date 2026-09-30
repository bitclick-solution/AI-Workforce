import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { principal } from './sembrar.js';

describe('principal (validación de entorno, sin tocar la base)', () => {
  let salida: string[];
  let exitCodeOriginal: number | string | null | undefined;

  beforeEach(() => {
    salida = [];
    vi.spyOn(console, 'error').mockImplementation((...partes: unknown[]) => {
      salida.push(partes.map(String).join(' '));
    });
    exitCodeOriginal = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = exitCodeOriginal;
  });

  it('falla rápido si falta DATABASE_URL, sin intentar conectar', async () => {
    await principal({});
    expect(salida.join('\n')).toContain('DATABASE_URL');
    expect(process.exitCode).toBe(1);
  });
});
