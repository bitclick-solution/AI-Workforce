import { describe, expect, it } from 'vitest';

import { CATALOGO_DE_HABILIDADES, habilidadDelCatalogo } from './catalogo-habilidades.js';

describe('catálogo de habilidades — esquema', () => {
  it('el catálogo del repositorio es válido y llega vacío en esta rebanada', () => {
    expect(CATALOGO_DE_HABILIDADES.habilidades).toEqual([]);
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
      fuentes: [{ titulo: 'Calendario del contribuyente', url: 'https://sede.agenciatributaria.gob.es' }],
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
