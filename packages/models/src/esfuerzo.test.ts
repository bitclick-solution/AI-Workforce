import { describe, expect, it } from 'vitest';

import { esfuerzoParaClase } from './esfuerzo.js';

describe('esfuerzoParaClase (ADR-018)', () => {
  it('aplica el nivel por defecto de la clase cuando el puesto no lo fija', () => {
    const sinFijar = { esfuerzoPorClasePaso: {} };
    expect(esfuerzoParaClase(sinFijar, 'moderador_sala')).toBe('low');
    expect(esfuerzoParaClase(sinFijar, 'enrutado')).toBe('low');
    expect(esfuerzoParaClase(sinFijar, 'resumen')).toBe('low');
    expect(esfuerzoParaClase(sinFijar, 'rutina')).toBe('low');
    expect(esfuerzoParaClase(sinFijar, 'negocio')).toBe('medium');
    expect(esfuerzoParaClase(sinFijar, 'razonamiento_financiero')).toBe('high');
    expect(esfuerzoParaClase(sinFijar, 'conciliacion')).toBe('high');
    expect(esfuerzoParaClase(sinFijar, 'decision_escritura')).toBe('high');
  });

  it('el máximo no es el nivel por defecto de ninguna clase: solo se pide explícitamente', () => {
    const sinFijar = { esfuerzoPorClasePaso: {} };
    expect(esfuerzoParaClase(sinFijar, 'certificacion')).not.toBe('max');
  });

  it('lo que fija la versión de puesto gana al nivel por defecto', () => {
    const configuracion = { esfuerzoPorClasePaso: { negocio: 'high' as const } };
    expect(esfuerzoParaClase(configuracion, 'negocio')).toBe('high');
  });

  it('un caso de certificación puede pedir el máximo explícitamente', () => {
    const configuracion = { esfuerzoPorClasePaso: { certificacion: 'max' as const } };
    expect(esfuerzoParaClase(configuracion, 'certificacion')).toBe('max');
  });
});
