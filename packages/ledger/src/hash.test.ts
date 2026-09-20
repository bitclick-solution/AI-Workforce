import { describe, expect, it } from 'vitest';

import {
  HASH_GENESIS,
  calcularHash,
  normalizarImporte,
  serializarCanonico,
  verificarCadena,
  type ContenidoEntrada,
  type EslabonVerificable,
} from './hash.js';

const TENANT = '01920000-0000-7000-8000-000000000001';

function contenido(numeroOrden: number, accion = 'odoo.crear_factura'): ContenidoEntrada {
  return {
    tenantId: TENANT,
    numeroOrden,
    creadoEn: new Date('2026-09-19T08:00:00.000Z'),
    actorTipo: 'agente',
    puestoId: '01920000-0000-7000-8000-00000000000a',
    accion,
    datosReferenciados: [{ tipo: 'factura', id: '42', sistema: 'odoo' }],
    resultado: 'exito',
    costeEuros: 0.0123,
    duracionMs: 850,
  };
}

function encadenar(cuantas: number): EslabonVerificable[] {
  const eslabones: EslabonVerificable[] = [];
  let anterior = HASH_GENESIS;
  for (let n = 1; n <= cuantas; n += 1) {
    const base = contenido(n);
    const hash = calcularHash(base, anterior);
    eslabones.push({ ...base, hash, hashAnterior: anterior });
    anterior = hash;
  }
  return eslabones;
}

describe('serialización canónica', () => {
  it('ordena las claves, así que el orden del objeto no cambia el hash', () => {
    expect(serializarCanonico({ b: 1, a: 2 })).toBe(serializarCanonico({ a: 2, b: 1 }));
  });

  it('escribe las fechas en ISO', () => {
    expect(serializarCanonico(new Date('2026-09-19T08:00:00.000Z'))).toBe(
      '"2026-09-19T08:00:00.000Z"',
    );
  });

  it('trata undefined y null igual, para que no dependan del lenguaje', () => {
    expect(serializarCanonico({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it('rechaza números que no son finitos', () => {
    expect(() => serializarCanonico({ coste: Number.POSITIVE_INFINITY })).toThrow(/no finitos/);
  });
});

describe('normalizarImporte', () => {
  it('deja cuatro decimales, que es lo que guarda la columna', () => {
    expect(normalizarImporte(0.123456)).toBe('0.1235');
    expect(normalizarImporte(2)).toBe('2.0000');
  });

  it('rechaza importes no finitos', () => {
    expect(() => normalizarImporte(Number.NaN)).toThrow(/no finito/);
  });
});

describe('calcularHash', () => {
  it('es estable: el mismo contenido da siempre el mismo hash', () => {
    expect(calcularHash(contenido(1), HASH_GENESIS)).toBe(calcularHash(contenido(1), HASH_GENESIS));
  });

  it('cambia si cambia cualquier campo', () => {
    const base = calcularHash(contenido(1), HASH_GENESIS);
    expect(calcularHash(contenido(1, 'odoo.borrar_factura'), HASH_GENESIS)).not.toBe(base);
    expect(calcularHash(contenido(2), HASH_GENESIS)).not.toBe(base);
  });

  it('cambia si cambia el hash anterior', () => {
    const otro = 'f'.repeat(64);
    expect(calcularHash(contenido(1), otro)).not.toBe(calcularHash(contenido(1), HASH_GENESIS));
  });

  it('rechaza un hash anterior que no lo es', () => {
    expect(() => calcularHash(contenido(1), 'no-es-un-hash')).toThrow(/Hash anterior no válido/);
    expect(() => calcularHash(contenido(1), 'ABC')).toThrow(/Hash anterior no válido/);
  });

  it('rechaza un número de orden que no empieza en uno', () => {
    expect(() => calcularHash(contenido(0), HASH_GENESIS)).toThrow(/Número de orden no válido/);
    expect(() => calcularHash(contenido(1.5), HASH_GENESIS)).toThrow(/Número de orden no válido/);
  });
});

describe('verificarCadena', () => {
  it('una cadena vacía es válida: el tenant no ha hecho nada todavía', () => {
    expect(verificarCadena([])).toEqual({ valida: true, entradas: 0 });
  });

  it('acepta una cadena bien construida', () => {
    const resultado = verificarCadena(encadenar(25));
    expect(resultado.valida).toBe(true);
    expect(resultado.entradas).toBe(25);
  });

  it('detecta una entrada alterada', () => {
    const cadena = encadenar(5);
    const alterada = cadena[2];
    if (!alterada) throw new Error('cadena corta');
    cadena[2] = { ...alterada, costeEuros: 999 };
    const resultado = verificarCadena(cadena);
    expect(resultado.valida).toBe(false);
    expect(resultado.rotaEn).toBe(3);
    expect(resultado.motivo).toMatch(/alterada/);
  });

  it('detecta un hueco en la numeración', () => {
    const cadena = encadenar(4);
    cadena.splice(1, 1);
    const resultado = verificarCadena(cadena);
    expect(resultado.valida).toBe(false);
    expect(resultado.motivo).toMatch(/Falta la entrada 2/);
  });

  it('detecta un eslabón que no encadena con el anterior', () => {
    const cadena = encadenar(3);
    const segundo = cadena[1];
    if (!segundo) throw new Error('cadena corta');
    cadena[1] = { ...segundo, hashAnterior: 'a'.repeat(64) };
    const resultado = verificarCadena(cadena);
    expect(resultado.valida).toBe(false);
    expect(resultado.rotaEn).toBe(2);
    expect(resultado.motivo).toMatch(/no encadena/);
  });

  it('trata el hash anterior nulo de la primera entrada como génesis', () => {
    const cadena = encadenar(2);
    const primero = cadena[0];
    if (!primero) throw new Error('cadena corta');
    cadena[0] = { ...primero, hashAnterior: null };
    expect(verificarCadena(cadena).valida).toBe(true);
  });
});
