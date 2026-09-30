import { describe, expect, it } from 'vitest';

import { buscarHabilidadCongelada, leerHabilidadesCongeladas, lineasDeHabilidades } from './habilidades.js';

const ITEM = {
  habilidadId: 'h1',
  nombre: 'cobros.antiguedad-de-cobros',
  version: 1,
  casosQueAplican: ['agrupar facturas vencidas por tramo'],
  pasos: ['Agrupa por tramo de antigüedad.'],
  comprobaciones: ['La suma de tramos coincide con el total.'],
  herramientas: ['listar_facturas_vencidas'],
};

describe('habilidades en el bucle — funciones puras', () => {
  it('lee «[]» de una versión anterior a esta rebanada sin romperse', () => {
    expect(leerHabilidadesCongeladas(undefined)).toEqual([]);
    expect(leerHabilidadesCongeladas(null)).toEqual([]);
  });

  it('rechaza una carga que no cumple el esquema', () => {
    expect(() => leerHabilidadesCongeladas([{ nombre: '' }])).toThrow();
  });

  it('el índice tiene una línea por habilidad, con el nombre y los casos que aplican', () => {
    const lineas = lineasDeHabilidades([ITEM]);
    expect(lineas).toEqual(['cobros.antiguedad-de-cobros: agrupar facturas vencidas por tramo']);
  });

  it('sin habilidades congeladas, el índice está vacío', () => {
    expect(lineasDeHabilidades([])).toEqual([]);
  });

  it('busca una habilidad congelada por su nombre exacto', () => {
    expect(buscarHabilidadCongelada([ITEM], 'cobros.antiguedad-de-cobros')).toEqual(ITEM);
    expect(buscarHabilidadCongelada([ITEM], 'otra-que-no-existe')).toBeUndefined();
  });
});
