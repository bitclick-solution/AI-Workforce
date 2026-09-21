import { describe, expect, it } from 'vitest';

import { contratoDelegacion, resolverRespaldo, type ContratoDelegacion } from './delegacion.js';

const valido: ContratoDelegacion = {
  encargo: 'Concilia la factura F-2026-0001 con el extracto bancario.',
  plazoSegundos: 600,
  presupuestoEuros: 0.5,
  formato: { formato: 'json', criteriosAceptacion: ['Indica el asiento propuesto'] },
  caducidadSegundos: 900,
  politicaRespaldo: 'seguir_sin_ello',
};

describe('contrato de delegación · ADR-004 y ADR-014', () => {
  it('acepta un contrato completo', () => {
    expect(contratoDelegacion.parse(valido).encargo).toContain('F-2026-0001');
  });

  it.each([
    ['encargo', { encargo: '' }],
    ['plazo', { plazoSegundos: 0 }],
    ['presupuesto', { presupuestoEuros: -1 }],
  ])('rechaza un contrato sin %s válido', (_campo, parche) => {
    expect(contratoDelegacion.safeParse({ ...valido, ...parche }).success).toBe(false);
  });

  it('exige caducidad y política de respaldo: sin ellas no hay contrato', () => {
    const { caducidadSegundos: _c, politicaRespaldo: _p, ...sinAdr014 } = valido;
    expect(contratoDelegacion.safeParse(sinAdr014).success).toBe(false);
  });

  it('rechaza una caducidad anterior al plazo', () => {
    const resultado = contratoDelegacion.safeParse({ ...valido, caducidadSegundos: 60 });
    expect(resultado.success).toBe(false);
    if (!resultado.success) {
      expect(resultado.error.issues[0]?.message).toContain('imposible de cumplir');
    }
  });
});

describe('política de respaldo', () => {
  it('seguir sin ello continúa el bucle del padre', () => {
    const respaldo = resolverRespaldo('seguir_sin_ello');
    expect(respaldo.continua).toBe(true);
    expect(respaldo.escala).toBe(false);
  });

  it('aparcar no continúa y no escala', () => {
    expect(resolverRespaldo('aparcar')).toMatchObject({ continua: false, escala: false });
  });

  it('escalar a persona no continúa y pide decisión', () => {
    expect(resolverRespaldo('escalar_a_persona')).toMatchObject({ continua: false, escala: true });
  });
});
