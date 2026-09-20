/**
 * Un secreto no se imprime por ninguna de las tres puertas.
 *
 * La definición de hecho pide una prueba de que ninguna credencial entra en código,
 * prompts ni registros. Esta es la parte de los registros: se comprueba que el valor
 * no sale ni al interpolar, ni al serializar, ni al inspeccionar, que son las tres
 * formas en que un secreto acaba en una traza sin que nadie lo haya querido.
 */
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Secreto, TEXTO_OCULTO } from './secreto.js';

const VALOR = randomBytes(24).toString('hex');

describe('Secreto', () => {
  it('devuelve el valor solo cuando se lo pides a propósito', () => {
    expect(new Secreto(VALOR, 'CLAVE').revelar()).toBe(VALOR);
  });

  it('no sale al interpolar en una cadena', () => {
    const secreto = new Secreto(VALOR, 'CLAVE');
    expect(`${secreto}`).toBe(TEXTO_OCULTO);
    expect(String(secreto)).not.toContain(VALOR);
    expect(`clave=${secreto}`).not.toContain(VALOR);
  });

  it('no sale al serializar el objeto que lo contiene', () => {
    const configuracion = { clave: new Secreto(VALOR, 'CLAVE'), puerto: 4010 };
    expect(JSON.stringify(configuracion)).not.toContain(VALOR);
    expect(JSON.stringify(configuracion)).toContain(TEXTO_OCULTO);
  });

  it('no sale al inspeccionar, que es lo que hace console.log de un objeto', () => {
    const anidado = { nivel: { secreto: new Secreto(VALOR, 'CLAVE') } };
    expect(inspect(anidado, { depth: 5 })).not.toContain(VALOR);
  });

  it('dice su nombre y su longitud sin decir su valor', () => {
    const secreto = new Secreto(VALOR, 'AIW_APROBACION_CLAVE_FIRMA');
    expect(secreto.nombre).toBe('AIW_APROBACION_CLAVE_FIRMA');
    expect(secreto.longitud).toBe(VALOR.length);
    expect(secreto.vacio).toBe(false);
  });

  it('el secreto vacío se reconoce como vacío', () => {
    expect(new Secreto('', 'CLAVE').vacio).toBe(true);
  });
});
