import { describe, expect, it } from 'vitest';

import type {
  AvanceHaciaElAscenso,
  CambioDeNivelDelExpediente,
} from '../../../../../../lib/expediente';
import {
  criteriosDelAscenso,
  enlaceAlLibro,
  estadoDeLaLeccion,
  fraseDelCambio,
  origenDelCambio,
  textoSinAscenso,
} from './presentacion';

const CAMBIO: CambioDeNivelDelExpediente = {
  claseAccion: 'escritura',
  de: 'n1',
  a: 'n2',
  versionPuestoId: 'v3',
  numeroVersion: 3,
  fecha: '2026-09-22T10:00:00.000Z',
  leccionId: 'l1',
  decididaPorPersonaId: 'p1',
};

describe('fraseDelCambio', () => {
  it('dice si sube o baja, con el nombre de cada nivel', () => {
    expect(fraseDelCambio({ de: 'n1', a: 'n2' })).toBe(
      'Subió de N1 · supervisado a N2 · autónomo con aviso',
    );
    expect(fraseDelCambio({ de: 'n2', a: 'n0' })).toBe(
      'Bajó de N2 · autónomo con aviso a N0 · manual',
    );
  });

  it('cuenta la clase que entra o sale de la política', () => {
    expect(fraseDelCambio({ de: null, a: 'n0' })).toContain('Entró en la política con N0');
    expect(fraseDelCambio({ de: 'n1', a: null })).toContain('Salió de la política');
  });
});

describe('origenDelCambio', () => {
  it('nombra la versión, la lección y que lo decidió una persona', () => {
    const texto = origenDelCambio(CAMBIO, [
      {
        leccionId: 'l1',
        titulo: 'Saluda por el nombre',
        linea: '',
        estado: 'vigente',
        promocionId: 'pr1',
        versionPuestoId: 'v3',
      },
    ]);
    expect(texto).toBe(
      'Versión 3 · por la lección «Saluda por el nombre» · decidido por una persona',
    );
  });

  it('sin lección conocida no inventa su título', () => {
    expect(origenDelCambio({ ...CAMBIO, decididaPorPersonaId: null }, [])).toBe(
      'Versión 3 · por una lección promocionada',
    );
    expect(origenDelCambio({ ...CAMBIO, leccionId: null, decididaPorPersonaId: null }, [])).toBe(
      'Versión 3',
    );
  });
});

describe('textoSinAscenso', () => {
  it('«fijo» se dice como fijo, con su nivel', () => {
    expect(textoSinAscenso('fijo', 'n1')).toBe(
      'Fijo en N1 · supervisado: la primera versión no ofrece el ascenso en esta clase.',
    );
  });

  it('cubre el resto de motivos', () => {
    expect(textoSinAscenso('prohibida', null)).toContain('Prohibida');
    expect(textoSinAscenso('nivel_maximo', 'n3')).toContain('más alto');
    expect(textoSinAscenso('sin_criterio', 'n0')).toContain('N0 · manual');
  });
});

describe('criteriosDelAscenso', () => {
  const avance: AvanceHaciaElAscenso = {
    de: 'n1',
    a: 'n2',
    acciones: { actual: 12, requerido: 30, cumplido: false },
    aprobadasSinCambiosPct: { actual: 96.8, requerido: 95, cumplido: true },
    diasSinIncidentes: { actual: null, requerido: 30, cumplido: false },
    confirmacion: { confirmada: false, cumplido: false },
    cumplidos: 1,
    total: 4,
  };

  it('devuelve los cuatro criterios con su valor actual', () => {
    const c = criteriosDelAscenso(avance);
    expect(c.map((x) => x.id)).toEqual(['acciones', 'aprobadas', 'dias', 'confirmacion']);
    expect(c[0]).toMatchObject({ valor: '12 de 30', requerido: 'al menos 30', cumplido: false });
    expect(c[0]?.progreso).toBeCloseTo(0.4);
    expect(c[1]).toMatchObject({ valor: '96,8 %', cumplido: true });
    expect(c[3]).toMatchObject({ valor: 'Sin confirmar', cumplido: false });
  });

  it('un criterio sin dato no enseña valor ni progreso', () => {
    const dias = criteriosDelAscenso(avance)[2];
    expect(dias).toMatchObject({ valor: null, progreso: null, cumplido: false });
  });
});

describe('estadoDeLaLeccion y enlaceAlLibro', () => {
  it('cada estado lleva su etiqueta', () => {
    expect(estadoDeLaLeccion('vigente').etiqueta).toBe('Vigente');
    expect(estadoDeLaLeccion('retirada').etiqueta).toBe('Retirada');
    expect(estadoDeLaLeccion('propuesta').etiqueta).toBe('Propuesta');
  });

  it('el enlace al libro apunta al paso de la tarea', () => {
    expect(enlaceAlLibro('t 1', 7)).toBe('/panel/inicio/tarea/t%201#paso-7');
  });
});
