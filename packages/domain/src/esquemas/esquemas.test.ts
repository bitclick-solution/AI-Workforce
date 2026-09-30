import { describe, expect, it } from 'vitest';

import {
  borradorOpaco,
  configuracionModeloPuesto,
  edicionBorrador,
  habilidadesCongeladas,
  memoriaCongelada,
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

  it('valida la configuración de modelo de una versión de puesto (ADR-018)', () => {
    const configuracion = validarCarga(
      configuracionModeloPuesto,
      {
        modelo: 'sonnet5',
        modeloRespaldo: 'haiku45',
        esfuerzoPorClasePaso: { negocio: 'medium', conciliacion: 'high' },
      },
      'version_puesto.configuracion_modelo',
    );
    expect(configuracion.modelo).toBe('sonnet5');
    expect(configuracion.modeloRespaldo).toBe('haiku45');
    expect(configuracion.esfuerzoPorClasePaso.conciliacion).toBe('high');
  });

  it('el respaldo es opcional: un puesto sin segundo intento lo deja en nulo', () => {
    const configuracion = configuracionModeloPuesto.parse({ modelo: 'opus5' });
    expect(configuracion.modeloRespaldo).toBeNull();
    expect(configuracion.esfuerzoPorClasePaso).toEqual({});
  });

  it('rechaza un papel de modelo que no es de los tres del ADR-018', () => {
    expect(() =>
      validarCarga(
        configuracionModeloPuesto,
        { modelo: 'gpt-5' },
        'version_puesto.configuracion_modelo',
      ),
    ).toThrow(/version_puesto\.configuracion_modelo/);
  });

  it('el mensaje de error nombra la columna que se iba a escribir', () => {
    expect(() => validarCarga(borradorOpaco, { carga: 1 }, 'aprobacion.borrador_opaco')).toThrow(
      /Carga jsonb no válida para aprobacion\.borrador_opaco/,
    );
  });

  it('la edición del borrador exige la carga de antes y la de después', () => {
    expect(edicionBorrador.parse({ antes: { a: 1 }, despues: { a: 2 } })).toEqual({
      antes: { a: 1 },
      despues: { a: 2 },
    });
    expect(edicionBorrador.safeParse({ antes: { a: 1 } }).success).toBe(false);
  });

  it('lee la memoria congelada de las versiones anteriores como vacía', () => {
    expect(memoriaCongelada.parse({})).toEqual({ lineas: [] });
    expect(memoriaCongelada.safeParse({ lineas: [{ leccionId: '', texto: 'x' }] }).success).toBe(
      false,
    );
  });

  it('valida las habilidades congeladas de una versión de puesto, sin cuerpo obligatorio', () => {
    const habilidades = habilidadesCongeladas.parse([
      { habilidadId: 'h1', nombre: 'cobros.demo', version: 1, casosQueAplican: ['un caso'] },
    ]);
    expect(habilidades).toEqual([
      {
        habilidadId: 'h1',
        nombre: 'cobros.demo',
        version: 1,
        casosQueAplican: ['un caso'],
        pasos: [],
        comprobaciones: [],
        herramientas: [],
      },
    ]);
    expect(habilidadesCongeladas.safeParse([{ nombre: '', version: 1 }]).success).toBe(false);
    expect(habilidadesCongeladas.parse([])).toEqual([]);
  });
});
