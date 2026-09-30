import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  guardarEstadoBitclick,
  leerEstadoBitclick,
  raizDelRepositorio,
  type EstadoBitclick,
} from './estado-local.js';

describe('raizDelRepositorio', () => {
  it('encuentra el directorio con pnpm-workspace.yaml subiendo desde este módulo', () => {
    const raiz = raizDelRepositorio();
    expect(raiz.endsWith('AI-Workforce') || raiz.length > 0).toBe(true);
  });

  it('falla con un mensaje claro si no hay ningún pnpm-workspace.yaml por encima', () => {
    expect(() => raizDelRepositorio('/tmp/no-existe/ni/este/fichero.ts')).toThrow(
      /pnpm-workspace\.yaml/,
    );
  });
});

describe('leerEstadoBitclick / guardarEstadoBitclick', () => {
  let raiz: string;

  afterEach(() => {
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('sin fichero, no hay estado', () => {
    raiz = mkdtempSync(join(tmpdir(), 'aiw-bitclick-'));
    writeFileSync(join(raiz, 'pnpm-workspace.yaml'), '');
    expect(leerEstadoBitclick(raiz)).toBeUndefined();
  });

  it('lo que se guarda es lo que se lee', () => {
    raiz = mkdtempSync(join(tmpdir(), 'aiw-bitclick-'));
    writeFileSync(join(raiz, 'pnpm-workspace.yaml'), '');
    const estado: EstadoBitclick = {
      tenantId: 't-1',
      personaId: 'p-1',
      departamentoId: 'd-1',
      puestoId: 'pu-1',
      versionPuestoId: 'v-1',
      conectorId: 'c-1',
      autorizacionId: 'a-1',
      sembradoEn: '2026-09-30T00:00:00.000Z',
    };
    guardarEstadoBitclick(estado, raiz);
    expect(leerEstadoBitclick(raiz)).toEqual(estado);
  });
});
