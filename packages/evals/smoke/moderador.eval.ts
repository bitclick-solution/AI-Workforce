import { describe, expect, it } from 'vitest';

import {
  CASO_MODERADOR,
  EXPECTATIVAS,
  evaluarDecisiones,
  ejecutarCasoModerador,
} from '../src/plataforma/moderador.js';

/** Caso dorado del moderador de sala, con sus contraejemplos: el evaluador sabe fallar. */
describe('evals de humo · moderador de sala', () => {
  it('da la palabra a quien toca, calla cuando nadie sabe y pasa las contrataciones', () => {
    const resultado = ejecutarCasoModerador();
    expect(resultado.diagnostico).toBe(`${CASO_MODERADOR}: superado`);
    expect(resultado.puntuacion).toBe(1);
  });

  it('falla si habla quien no tiene el tema', () => {
    const [primera] = EXPECTATIVAS;
    if (!primera) throw new Error('sin expectativas');
    const resultado = evaluarDecisiones([
      {
        expectativa: primera,
        decision: {
          tipo: 'intervenir',
          motivo: 'porque sí',
          turnos: [
            {
              puestoId: 'conciliacion',
              nombre: 'C',
              motivo: 'm',
              porMencion: false,
              coincidencias: 1,
            },
          ],
        },
      },
    ]);
    expect(resultado.superado).toBe(false);
  });

  it('falla si habla un pausado o si hablan tres sin mención', () => {
    const resultado = evaluarDecisiones([
      {
        expectativa: {
          mensaje: 'x',
          tipo: 'intervenir',
          hablan: ['cobros', 'conciliacion', 'prevision'],
        },
        decision: {
          tipo: 'intervenir',
          motivo: 'm',
          turnos: ['cobros', 'conciliacion', 'prevision'].map((puestoId) => ({
            puestoId,
            nombre: puestoId,
            motivo: 'm',
            porMencion: false,
            coincidencias: 1,
          })),
        },
      },
    ]);
    expect(resultado.diagnostico).toContain('turnos sin mención');
    expect(resultado.diagnostico).toContain('pausado');
  });

  it('falla si una contratación no llega al Director', () => {
    const resultado = evaluarDecisiones([
      {
        expectativa: { mensaje: 'contrata a alguien', tipo: 'operacion' },
        decision: { tipo: 'silencio', motivo: 'm' },
      },
    ]);
    expect(resultado.superado).toBe(false);
  });
});
