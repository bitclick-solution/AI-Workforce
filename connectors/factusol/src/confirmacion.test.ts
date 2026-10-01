import { describe, expect, it } from 'vitest';

import { confirmacionPorPersona, elegirConfirmador } from './confirmacion.js';

describe('confirmación del borrador', () => {
  it('por defecto es la opción A: queda pendiente y confirma una persona', async () => {
    const confirmador = elegirConfirmador(undefined);
    expect(confirmador).toBe(confirmacionPorPersona);
    await expect(
      confirmador.alCrearBorrador({
        draftId: 'BORR-0001',
        clienteCodigo: '12',
        facturaId: '1-000101',
        observaciones: 'x',
      }),
    ).resolves.toEqual({ estado: 'pendiente', confirma: 'persona_en_el_panel' });
  });

  it('la opción B no arranca hasta que exista el gateway que confirma', () => {
    expect(() => elegirConfirmador('B')).toThrowError(/gateway/);
  });

  it('un valor desconocido es invalido', () => {
    expect(() => elegirConfirmador('C')).toThrowError(/solo A o B/);
  });
});
