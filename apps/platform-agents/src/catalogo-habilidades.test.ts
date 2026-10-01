import { describe, expect, it } from 'vitest';

import { CATALOGO_DE_HABILIDADES, habilidadDelCatalogo } from './catalogo-habilidades.js';

describe('catálogo de habilidades — esquema', () => {
  it('el catálogo del repositorio es válido y trae las nueve habilidades de Finanzas', () => {
    const porPuesto = (puesto: string) =>
      CATALOGO_DE_HABILIDADES.habilidades.filter((h) => h.puesto === puesto).length;
    expect(CATALOGO_DE_HABILIDADES.habilidades).toHaveLength(9);
    expect([porPuesto('cobros'), porPuesto('conciliacion'), porPuesto('prevision')]).toEqual([
      3, 3, 3,
    ]);
  });

  it('cada habilidad normativa del catálogo cita al menos una fuente con enlace', () => {
    const normativas = CATALOGO_DE_HABILIDADES.habilidades.filter((h) => h.normativa);
    expect(normativas.map((h) => h.id).sort()).toEqual([
      'cobros.demora-ley-3-2004',
      'conciliacion.devolucion-de-adeudo-sepa',
      'conciliacion.leer-norma-43',
      'prevision.calendario-fiscal',
    ]);
    for (const habilidad of normativas) {
      expect(habilidad.fuentes.length).toBeGreaterThan(0);
    }
  });

  it('acepta una habilidad sin contenido normativo sin exigir fuentes', () => {
    const habilidad = habilidadDelCatalogo.parse({
      id: 'prueba.demo',
      version: 1,
      puesto: 'cobros',
      nombre: 'Demo',
      casosQueAplican: ['un caso'],
      pasos: ['un paso'],
      comprobaciones: ['una comprobación'],
    });
    expect(habilidad.fuentes).toEqual([]);
  });

  it('rechaza una habilidad normativa sin ninguna fuente', () => {
    expect(() =>
      habilidadDelCatalogo.parse({
        id: 'prueba.normativa',
        version: 1,
        puesto: 'prevision',
        nombre: 'Demo normativa',
        casosQueAplican: ['un caso'],
        pasos: ['un paso'],
        comprobaciones: ['una comprobación'],
        normativa: true,
      }),
    ).toThrow();
  });

  it('acepta una habilidad normativa con su fuente oficial', () => {
    const habilidad = habilidadDelCatalogo.parse({
      id: 'prueba.normativa',
      version: 1,
      puesto: 'prevision',
      nombre: 'Demo normativa',
      casosQueAplican: ['un caso'],
      pasos: ['un paso'],
      comprobaciones: ['una comprobación'],
      normativa: true,
      fuentes: [
        { titulo: 'Calendario del contribuyente', url: 'https://sede.agenciatributaria.gob.es' },
      ],
    });
    expect(habilidad.fuentes).toHaveLength(1);
  });

  it('rechaza una herramienta sin pasos ni comprobaciones', () => {
    expect(() =>
      habilidadDelCatalogo.parse({
        id: 'prueba.vacia',
        version: 1,
        puesto: 'cobros',
        nombre: 'Vacía',
        casosQueAplican: ['un caso'],
        pasos: [],
        comprobaciones: [],
      }),
    ).toThrow();
  });
});
