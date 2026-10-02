import type { ResultadoDeLaPuerta, VersionCandidata } from '@aiw/learning';
import { describe, expect, it } from 'vitest';

import {
  CASO_APRENDIZAJE,
  CASO_APRENDIZAJE_DEPARTAMENTO,
  EDICION,
  certificarPromocion,
  ejecutarCasoAprendizaje,
  evaluarLeccion,
  evaluarLeccionDeDepartamento,
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

  describe('memoria de departamento', () => {
    /** La puerta de v0 es síncrona; el tipo admite también una promesa. */
    const certificar = (c: VersionCandidata) => certificarPromocion(c) as ResultadoDeLaPuerta;

    const candidata = {
      tenantId: 't',
      puestoId: 'p',
      leccionId: 'l1',
      ambito: 'departamento' as const,
      departamentoId: 'd',
      parametros: { clase: 'memoria' as const, destino: 'departamento', valor: 'Cita la factura.' },
      memoria: { lineas: [{ leccionId: 'l1', texto: 'Cita la factura.' }] },
    };

    it('una lección de departamento que cumple pasa la puerta', () => {
      expect(evaluarLeccionDeDepartamento(candidata).diagnostico).toBe(
        `${CASO_APRENDIZAJE_DEPARTAMENTO}: superado`,
      );
      const puerta = certificar(candidata);
      expect(puerta.certificada).toBe(true);
      expect(puerta.casos.map((caso) => caso.id)).toContain(CASO_APRENDIZAJE_DEPARTAMENTO);
    });

    it('una lección de puesto no pasa por las reglas de departamento', () => {
      const puerta = certificar({
        ...candidata,
        ambito: undefined,
        parametros: { ...candidata.parametros, destino: 'puesto' },
      });
      expect(puerta.casos.map((caso) => caso.id)).not.toContain(CASO_APRENDIZAJE_DEPARTAMENTO);
    });

    it('bloquea una lección marcada como categoría especial', () => {
      const puerta = certificar({ ...candidata, categoriaEspecial: true });
      expect(puerta.certificada).toBe(false);
      expect(JSON.stringify(puerta.casos)).toContain('categoría especial');
    });

    it('bloquea una lección que hablaba de una persona concreta', () => {
      const puerta = certificar({ ...candidata, datosPersonalesQuitados: ['correo'] });
      expect(puerta.certificada).toBe(false);
      expect(JSON.stringify(puerta.casos)).toContain('persona concreta');
    });

    it('bloquea una lección con destino de puesto que se intenta compartir', () => {
      const r = evaluarLeccionDeDepartamento({
        ...candidata,
        parametros: { ...candidata.parametros, destino: 'puesto' },
      });
      expect(r.superado).toBe(false);
    });

    it('bloquea si la memoria candidata baja la certificación (datos personales en una línea)', () => {
      const puerta = certificar({
        ...candidata,
        memoria: { lineas: [{ leccionId: 'l1', texto: 'IBAN ES91 2100 0418 4502 0005 1332' }] },
      });
      expect(puerta.certificada).toBe(false);
    });
  });
});
