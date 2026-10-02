import { describe, expect, it } from 'vitest';

import {
  CASO_MODERADOR_MODELO,
  EXPECTATIVAS_CON_MODELO,
  clasificadorDelCaso,
  ejecutarCasoModeradorConModelo,
  evaluarConModelo,
  reglasDejanEnSilencio,
} from '../src/plataforma/moderador-modelo.js';

/** Caso dorado del moderador con paso de modelo, con sus contraejemplos: el evaluador sabe fallar. */
describe('evals de humo · moderador de sala con paso de modelo', () => {
  it('las paráfrasis que las reglas dejarían en silencio dan la palabra a quien puede responder', async () => {
    for (const e of EXPECTATIVAS_CON_MODELO.filter((x) => x.ambito === 'departamento' && x.usaModelo)) {
      expect(reglasDejanEnSilencio(e.mensaje)).toBe(true);
    }
    const resultado = await ejecutarCasoModeradorConModelo(clasificadorDelCaso());
    expect(resultado.diagnostico).toBe(`${CASO_MODERADOR_MODELO}: superado`);
    expect(resultado.puntuacion).toBe(1);
  });

  it('un fallo del modelo deja el silencio, sin romper la sala', async () => {
    const resultado = await ejecutarCasoModeradorConModelo((() =>
      Promise.reject(new Error('proveedor caído'))) as never);
    expect(resultado.superado).toBe(false);
    expect(resultado.diagnostico).toContain('se esperaba intervenir y fue silencio');
  });

  it('falla si habla un puesto que no está en la sala o si hablan dos con el límite por defecto', () => {
    const [primera] = EXPECTATIVAS_CON_MODELO;
    if (!primera) throw new Error('sin expectativas');
    const turno = (puestoId: string) => ({
      puestoId,
      nombre: puestoId,
      motivo: 'm',
      porMencion: false,
      coincidencias: 0,
    });
    const fuera = evaluarConModelo([
      {
        expectativa: primera,
        usoModelo: true,
        decision: { tipo: 'intervenir', motivo: 'm', turnos: [turno('inventado')] },
      },
    ]);
    expect(fuera.diagnostico).toContain('no está en la sala');
    const dos = evaluarConModelo([
      {
        expectativa: primera,
        usoModelo: true,
        decision: { tipo: 'intervenir', motivo: 'm', turnos: [turno('cobros'), turno('conciliacion')] },
      },
    ]);
    expect(dos.diagnostico).toContain('2 turnos');
  });

  it('falla si la sala general gasta modelo', () => {
    const general = EXPECTATIVAS_CON_MODELO.find((e) => e.ambito === 'organizacion');
    if (!general) throw new Error('sin caso de sala general');
    const resultado = evaluarConModelo([
      { expectativa: general, usoModelo: true, decision: { tipo: 'silencio', motivo: 'm' } },
    ]);
    expect(resultado.superado).toBe(false);
  });
});
