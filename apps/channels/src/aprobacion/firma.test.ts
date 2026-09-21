/**
 * El token del enlace: lo que firma, lo que rechaza y en qué orden.
 *
 * Los casos de seguridad de la especificación viven aquí: enlace manipulado en la
 * carga, manipulado en la firma, firmado con otra clave, con otra versión y
 * caducado. La clave de las pruebas sale de `randomBytes`: en este repositorio no
 * se escribe ninguna clave, ni siquiera de juguete.
 */
import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Secreto } from '../secreto.js';

import {
  LONGITUD_MINIMA_CLAVE,
  VERSION_TOKEN,
  exigirClaveDeFirma,
  firmarEnlace,
  igualEnTiempoConstante,
  urlDelEnlace,
  verificarEnlace,
} from './firma.js';

const TENANT = '01920000-0000-7000-8000-000000000001';
const APROBACION = '01920000-0000-7000-8000-0000000000a1';
const TAREA = '01920000-0000-7000-8000-0000000000b1';

function clave(): Secreto {
  return new Secreto(randomBytes(32).toString('hex'), 'AIW_APROBACION_CLAVE_FIRMA');
}

const DENTRO_DE_UN_DIA = new Date(Date.UTC(2026, 8, 21, 12));
const AHORA = new Date(Date.UTC(2026, 8, 20, 12));

function token(secreto: Secreto, caducaEn = DENTRO_DE_UN_DIA): string {
  return firmarEnlace(
    secreto,
    { tenantId: TENANT, aprobacionId: APROBACION, tareaId: TAREA },
    { caducaEn },
  );
}

describe('exigirClaveDeFirma', () => {
  it('rechaza la clave ausente y dice qué variable falta', () => {
    expect(() => exigirClaveDeFirma(undefined, 'AIW_APROBACION_CLAVE_FIRMA')).toThrow(
      /AIW_APROBACION_CLAVE_FIRMA/,
    );
  });

  it('rechaza la clave vacía o de espacios', () => {
    expect(() => exigirClaveDeFirma('   ', 'AIW_APROBACION_CLAVE_FIRMA')).toThrow(/Falta/);
  });

  it('rechaza la clave corta y dice cuánto falta', () => {
    const corta = randomBytes(8)
      .toString('hex')
      .slice(0, LONGITUD_MINIMA_CLAVE - 1);
    expect(() => exigirClaveDeFirma(corta, 'AIW_APROBACION_CLAVE_FIRMA')).toThrow(
      /demasiado corta/,
    );
  });

  it('acepta una clave suficiente y la devuelve envuelta', () => {
    const secreto = exigirClaveDeFirma(
      randomBytes(32).toString('hex'),
      'AIW_APROBACION_CLAVE_FIRMA',
    );
    expect(secreto.longitud).toBe(64);
    expect(String(secreto)).not.toContain('0');
  });
});

describe('firmarEnlace y verificarEnlace', () => {
  it('firma y verifica la ida y vuelta', () => {
    const secreto = clave();
    const verificado = verificarEnlace(secreto, token(secreto), AHORA);
    expect(verificado.valido).toBe(true);
    if (!verificado.valido) return;
    expect(verificado.carga.tenantId).toBe(TENANT);
    expect(verificado.carga.aprobacionId).toBe(APROBACION);
    expect(verificado.carga.tareaId).toBe(TAREA);
  });

  it('el token lleva la versión delante para poder cambiar el formato luego', () => {
    const secreto = clave();
    expect(token(secreto).startsWith(`${VERSION_TOKEN}.`)).toBe(true);
    expect(token(secreto).split('.')).toHaveLength(3);
  });

  it('rechaza el token con la carga manipulada', () => {
    const secreto = clave();
    const partes = token(secreto).split('.');
    const otraCarga = Buffer.from(
      JSON.stringify({
        tenantId: '01920000-0000-7000-8000-000000000002',
        aprobacionId: APROBACION,
        tareaId: TAREA,
        caducaEn: Math.floor(DENTRO_DE_UN_DIA.getTime() / 1000),
      }),
      'utf8',
    ).toString('base64url');
    const manipulado = [partes[0], otraCarga, partes[2]].join('.');
    expect(verificarEnlace(secreto, manipulado, AHORA)).toEqual({
      valido: false,
      motivo: 'firma',
    });
  });

  it('rechaza el token con la firma manipulada', () => {
    const secreto = clave();
    const partes = token(secreto).split('.');
    const otraFirma = `${partes[2]?.slice(0, -1) ?? ''}${partes[2]?.endsWith('A') ? 'B' : 'A'}`;
    expect(
      verificarEnlace(secreto, [partes[0], partes[1], otraFirma].join('.'), AHORA).valido,
    ).toBe(false);
  });

  it('rechaza el token firmado con otra clave: rotar la clave revoca los enlaces', () => {
    const emitido = token(clave());
    expect(verificarEnlace(clave(), emitido, AHORA)).toEqual({ valido: false, motivo: 'firma' });
  });

  it('rechaza una firma de otra longitud sin lanzar', () => {
    const secreto = clave();
    const partes = token(secreto).split('.');
    const corta = [partes[0], partes[1], 'abc'].join('.');
    expect(() => verificarEnlace(secreto, corta, AHORA)).not.toThrow();
    expect(verificarEnlace(secreto, corta, AHORA).valido).toBe(false);
  });

  it('rechaza el token que no tiene tres partes', () => {
    const secreto = clave();
    for (const malo of ['', 'v1', 'v1.carga', 'v1.carga.firma.sobra']) {
      expect(verificarEnlace(secreto, malo, AHORA)).toEqual({ valido: false, motivo: 'formato' });
    }
  });

  it('rechaza el token con partes vacías', () => {
    expect(verificarEnlace(clave(), 'v1..', AHORA)).toEqual({ valido: false, motivo: 'formato' });
  });

  it('rechaza una versión que no conoce, antes de mirar la firma', () => {
    const secreto = clave();
    const partes = token(secreto).split('.');
    expect(verificarEnlace(secreto, ['v2', partes[1], partes[2]].join('.'), AHORA)).toEqual({
      valido: false,
      motivo: 'version',
    });
  });

  it('rechaza el token caducado y devuelve la carga para poder decirlo', () => {
    const secreto = clave();
    const caducado = token(secreto, new Date(AHORA.getTime() - 1000));
    const verificado = verificarEnlace(secreto, caducado, AHORA);
    expect(verificado.valido).toBe(false);
    if (verificado.valido) return;
    expect(verificado.motivo).toBe('caducado');
    expect(verificado.carga?.aprobacionId).toBe(APROBACION);
  });

  it('el instante exacto de caducidad ya no sirve', () => {
    const secreto = clave();
    const justo = new Date(Math.floor(AHORA.getTime() / 1000) * 1000);
    expect(verificarEnlace(secreto, token(secreto, justo), justo).valido).toBe(false);
  });

  it('rechaza una carga que no es el objeto esperado, con la firma buena', () => {
    const secreto = clave();
    for (const carga of ['null', '"texto"', '{}', '{"tenantId":"a"}', '[]']) {
      const cuerpo = `${VERSION_TOKEN}.${Buffer.from(carga, 'utf8').toString('base64url')}`;
      const firmado = firmarConClave(secreto, cuerpo);
      expect(verificarEnlace(secreto, firmado, AHORA)).toEqual({ valido: false, motivo: 'carga' });
    }
  });

  it('rechaza una carga que no es base64url válida, con la firma buena', () => {
    const secreto = clave();
    const cuerpo = `${VERSION_TOKEN}.no-es-json`;
    expect(verificarEnlace(secreto, firmarConClave(secreto, cuerpo), AHORA)).toEqual({
      valido: false,
      motivo: 'carga',
    });
  });
});

describe('igualEnTiempoConstante', () => {
  it('compara iguales y distintos sin lanzar por la longitud', () => {
    expect(igualEnTiempoConstante('abc', 'abc')).toBe(true);
    expect(igualEnTiempoConstante('abc', 'abd')).toBe(false);
    expect(igualEnTiempoConstante('abc', 'abcd')).toBe(false);
    expect(igualEnTiempoConstante('', '')).toBe(true);
  });
});

describe('urlDelEnlace', () => {
  it('compone la URL con la base de la configuración y no con la petición', () => {
    expect(urlDelEnlace('https://aiw.example', 'v1.a.b')).toBe(
      'https://aiw.example/aprobaciones/v1.a.b',
    );
  });

  it('no duplica la barra final de la base', () => {
    expect(urlDelEnlace('https://aiw.example/', 'v1.a.b')).toBe(
      'https://aiw.example/aprobaciones/v1.a.b',
    );
  });
});

/**
 * Firma un cuerpo ya compuesto, para construir tokens con firma buena y carga mala.
 * Es la única forma de probar la rama «la firma cuadra pero la carga no vale», que
 * es justo la que un atacante no puede alcanzar y un error nuestro sí.
 */
function firmarConClave(secreto: Secreto, cuerpo: string): string {
  const firma = createHmac('sha256', secreto.revelar()).update(cuerpo, 'utf8').digest('base64url');
  return `${cuerpo}.${firma}`;
}
