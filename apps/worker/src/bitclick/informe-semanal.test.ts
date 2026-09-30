import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as EstadoLocal from './estado-local.js';

vi.mock('./estado-local.js', async (importarOriginal) => ({
  ...(await importarOriginal<typeof EstadoLocal>()),
  leerEstadoBitclick: () => undefined,
}));

const { principal } = await import('./informe-semanal.js');

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

  it('falla rápido si falta DATABASE_URL', async () => {
    await principal({});
    expect(salida.join('\n')).toContain('DATABASE_URL');
    expect(process.exitCode).toBe(1);
  });

  it('sin haber sembrado antes, dice que siembres primero', async () => {
    await principal({ DATABASE_URL: 'postgres://x' });
    expect(salida.join('\n')).toContain('bitclick:sembrar');
    expect(process.exitCode).toBe(1);
  });
});
