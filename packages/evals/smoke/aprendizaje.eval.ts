import { describe, expect, it } from 'vitest';

import {
  CASO_APRENDIZAJE,
  EDICION,
  certificarPromocion,
  ejecutarCasoAprendizaje,
  evaluarLeccion,
} from '../src/plataforma/aprendizaje.js';

/**
 * Caso dorado del aprendizaje v0 y puerta del Evaluador. Deterministas y sin coste.
 *
 * Como en los casos de los puestos, se comprueba que el evaluador sabe fallar: cada
 * regla tiene su contraejemplo, porque un evaluador que siempre dice sí no protege
 * ninguna promoción.
 */
describe('evals de humo · aprendizaje', () => {
  const buena = {
    linea:
      'En herramienta.redactar_nota, la persona cambió el texto a «Te escribo para recordarte…».',
    parametros: { clase: 'memoria', destino: 'puesto', valor: '' },
  };
  buena.parametros.valor = buena.linea;

  it('una edición produce una lección de memoria acotada y sin datos personales', () => {
    const resultado = ejecutarCasoAprendizaje();
    expect(resultado.diagnostico).toBe(`${CASO_APRENDIZAJE}: superado`);
    expect(resultado.superado).toBe(true);
  });

  it('falla si la lección toca el modelo base', () => {
    const r = evaluarLeccion(
      { ...buena, parametros: { ...buena.parametros, clase: 'modelo_base' } },
      'Te escribo',
    );
    expect(r.superado).toBe(false);
    expect(r.diagnostico).toContain('ADR-005');
  });

  it('falla si la lección arrastra un correo o un teléfono del cliente', () => {
    const linea = `${buena.linea} Escribe a marta@cliente.es o al 612 345 678.`;
    const r = evaluarLeccion(
      { linea, parametros: { ...buena.parametros, valor: linea } },
      'Te escribo',
    );
    expect(r.diagnostico).toContain('datos personales');
  });

  it('falla si la lección no recoge lo que escribió la persona', () => {
    expect(evaluarLeccion(buena, 'Hola, Marta').diagnostico).toContain('no recoge');
  });

  it('falla si lo que se guarda no es lo que se enseña', () => {
    const r = evaluarLeccion(
      { ...buena, parametros: { ...buena.parametros, valor: 'otra cosa' } },
      'Te escribo',
    );
    expect(r.diagnostico).toContain('no es lo que se enseña');
  });

  it('la puerta certifica una memoria limpia y bloquea una con datos personales', () => {
    const candidata = {
      tenantId: 't',
      puestoId: 'p',
      leccionId: 'l1',
      parametros: { clase: 'memoria' as const, destino: 'puesto', valor: buena.linea },
      memoria: { lineas: [{ leccionId: 'l1', texto: buena.linea }] },
    };
    const certifica = certificarPromocion(candidata);
    expect(certifica).toMatchObject({ certificada: true });

    const sucia = {
      ...candidata,
      memoria: { lineas: [{ leccionId: 'l1', texto: `IBAN ${'ES91 2100 0418 4502 0005 1332'}` }] },
    };
    const bloquea = certificarPromocion(sucia);
    expect(bloquea).toMatchObject({ certificada: false });
  });

  it('el caso usa una edición con datos personales de verdad', () => {
    expect(EDICION.despues.argumentos.texto).toContain('@');
  });
});
