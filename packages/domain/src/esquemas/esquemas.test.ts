import { describe, expect, it } from 'vitest';

import {
  borradorOpaco,
  nivelAutonomia,
  parametrosLeccion,
  politicaPuesto,
  validarCarga,
} from './index.js';

describe('esquemas de las cargas jsonb', () => {
  it('acepta los cuatro niveles de autonomía y rechaza cualquier otro', () => {
    for (const nivel of ['n0', 'n1', 'n2', 'n3']) {
      expect(nivelAutonomia.parse(nivel)).toBe(nivel);
    }
    expect(() => nivelAutonomia.parse('n4')).toThrow();
    expect(() => nivelAutonomia.parse('N1')).toThrow();
  });

  it('valida una política de puesto con niveles por clase de acción', () => {
    const politica = validarCarga(
      politicaPuesto,
      { niveles: { 'pago.emitir': 'n1', 'odoo.leer': 'n3' } },
      'version_puesto.politica',
    );
    expect(politica.niveles['pago.emitir']).toBe('n1');
    expect(politica.guardiasEntrada).toEqual([]);
  });

  it('rechaza un nivel inventado y dice dónde falla', () => {
    expect(() =>
      validarCarga(politicaPuesto, { niveles: { 'pago.emitir': 'n9' } }, 'version_puesto.politica'),
    ).toThrow(/version_puesto\.politica/);
  });

  it('no interpreta la carga del borrador de aprobación: es opaca', () => {
    const borrador = validarCarga(
      borradorOpaco,
      { tipo: 'pago', carga: { cualquierCosa: [1, 2, 3] } },
      'aprobacion.borrador_opaco',
    );
    expect(borrador.tipo).toBe('pago');
  });

  it('acota el aprendizaje a memoria, habilidades, parámetros y ejemplos', () => {
    expect(
      parametrosLeccion.parse({ clase: 'memoria', destino: 'puesto', valor: 'albarán' }).clase,
    ).toBe('memoria');
    expect(() =>
      parametrosLeccion.parse({ clase: 'modelo_base', destino: 'puesto', valor: 'gpt' }),
    ).toThrow();
  });

  it('el mensaje de error nombra la columna que se iba a escribir', () => {
    expect(() => validarCarga(borradorOpaco, { carga: 1 }, 'aprobacion.borrador_opaco')).toThrow(
      /Carga jsonb no válida para aprobacion\.borrador_opaco/,
    );
  });
});
