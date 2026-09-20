import { describe, expect, it } from 'vitest';

import { momentoDeUuidV7, uuidV7 } from './identificadores.js';

describe('uuidV7', () => {
  it('tiene el formato y los bits de la versión 7', () => {
    const uuid = uuidV7();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('crece con el tiempo, que es lo que evita fragmentar los índices', () => {
    const antiguo = uuidV7(new Date('2026-01-01T00:00:00.000Z'));
    const reciente = uuidV7(new Date('2026-09-19T00:00:00.000Z'));
    expect(antiguo < reciente).toBe(true);
  });

  it('dos identificadores del mismo milisegundo son distintos', () => {
    const momento = new Date('2026-09-19T10:00:00.000Z');
    const generados = new Set(Array.from({ length: 200 }, () => uuidV7(momento)));
    expect(generados.size).toBe(200);
  });

  it('guarda el momento en el que se generó', () => {
    const momento = new Date('2026-09-19T10:11:12.013Z');
    expect(momentoDeUuidV7(uuidV7(momento)).toISOString()).toBe(momento.toISOString());
  });
});
