import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { almacenDeBorradoresEnFichero, type BorradorGuardado } from './almacen-borradores.js';

const BORRADOR: BorradorGuardado = {
  huella: 'h',
  draftId: 'BORR-0001',
  clienteCodigo: '12',
  observaciones: 'a\n[2026-09-21] x',
  linea: '[2026-09-21] x',
  creadoEn: '2026-09-21T09:00:00.000Z',
};

let directorio: string | undefined;

afterEach(async () => {
  if (directorio !== undefined) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

describe('almacén de borradores en fichero', () => {
  it('guarda, lee y borra por clave, y sobrevive a un almacén nuevo', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'factusol-'));
    await almacenDeBorradoresEnFichero(directorio).guardar('cobro-1', BORRADOR);
    const otro = almacenDeBorradoresEnFichero(directorio);
    expect(await otro.leer('cobro-1')).toEqual(BORRADOR);
    expect(await otro.leer('otra')).toBeUndefined();
    await otro.borrar('cobro-1');
    expect(await otro.leer('cobro-1')).toBeUndefined();
  });

  it('una clave con ../ no sale del directorio y no deja secretos', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'factusol-'));
    await almacenDeBorradoresEnFichero(directorio).guardar('../../escapada', BORRADOR);
    const ficheros = await readdir(directorio);
    expect(ficheros).toHaveLength(1);
    expect(ficheros[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });
});
