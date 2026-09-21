import { describe, expect, it } from 'vitest';

import { FRASES_DE_EJEMPLO, interpretarFrase } from './frases';

describe('interpretarFrase', () => {
  it('reconoce la contratación del puesto que el prototipo trae', () => {
    const respuesta = interpretarFrase('Contrata un agente de conciliación en Finanzas');
    expect(respuesta.veredicto).toBe('propuesta');
    expect(respuesta.motivo).toContain('Conciliación bancaria');
  });

  it('no depende de los acentos ni de las mayúsculas', () => {
    expect(interpretarFrase('CONCILIACION').veredicto).toBe('propuesta');
    expect(interpretarFrase('  conciliación  ').veredicto).toBe('propuesta');
  });

  it('manda a una persona lo que es de riesgo crítico', () => {
    const respuesta = interpretarFrase('Contrata un agente que pague las facturas de proveedor');
    expect(respuesta.veredicto).toBe('necesita-persona');
    expect(respuesta.motivo).toContain('riesgo crítico');
  });

  it('el riesgo crítico manda aunque la frase también hable de conciliación', () => {
    expect(interpretarFrase('un agente de conciliación que pague las diferencias').veredicto).toBe(
      'necesita-persona',
    );
  });

  it('dice que no entiende lo que no tiene puesto', () => {
    const respuesta = interpretarFrase('Contrata un agente de marketing para las redes');
    expect(respuesta.veredicto).toBe('no-reconocida');
    expect(respuesta.motivo).toContain('Finanzas');
  });

  it('trata la frase vacía como no reconocida y lo dice sin regañar', () => {
    const respuesta = interpretarFrase('   ');
    expect(respuesta.veredicto).toBe('no-reconocida');
    expect(respuesta.motivo).toBe('No has escrito nada todavía.');
  });

  it('las tres frases de ejemplo llevan cada una a un camino distinto', () => {
    const veredictos = FRASES_DE_EJEMPLO.map((frase) => interpretarFrase(frase).veredicto);
    expect(new Set(veredictos).size).toBe(3);
  });
});
