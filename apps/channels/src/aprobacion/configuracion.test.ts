/**
 * La configuración: la bandera manda, y la clave no se filtra.
 *
 * Se le pasa un entorno como objeto en vez de tocar `process.env`: así las pruebas
 * no se pisan entre ellas y se puede comprobar el caso «no hay ninguna variable».
 */
import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import { banderaEncendida, leerConfiguracion, type Entorno } from './configuracion.js';

const CLAVE = randomBytes(32).toString('hex');

function entorno(extra: Entorno = {}): Entorno {
  return { AIW_APROBACION_CORREO: '1', AIW_APROBACION_CLAVE_FIRMA: CLAVE, ...extra };
}

describe('bandera de funcionalidad', () => {
  it('está apagada cuando no hay variable', () => {
    expect(banderaEncendida({})).toBe(false);
    expect(leerConfiguracion({}).activa).toBe(false);
  });

  it('se enciende con los valores afirmativos y con nada más', () => {
    for (const valor of ['1', 'true', 'TRUE', 'si', 'sí', 'on']) {
      expect(banderaEncendida({ AIW_APROBACION_CORREO: valor })).toBe(true);
    }
    for (const valor of ['0', 'false', 'no', '', 'quizá']) {
      expect(banderaEncendida({ AIW_APROBACION_CORREO: valor })).toBe(false);
    }
  });

  it('apagada no exige clave de firma: el proceso arranca y termina', () => {
    const configuracion = leerConfiguracion({ AIW_APROBACION_CORREO: '0' });
    expect(configuracion.activa).toBe(false);
    expect(configuracion.claveDeFirma.vacio).toBe(true);
  });

  it('encendida sin clave falla al arrancar y dice qué variable falta', () => {
    expect(() => leerConfiguracion({ AIW_APROBACION_CORREO: '1' })).toThrow(
      /AIW_APROBACION_CLAVE_FIRMA/,
    );
  });

  it('encendida con clave corta falla al arrancar', () => {
    expect(() =>
      leerConfiguracion({ AIW_APROBACION_CORREO: '1', AIW_APROBACION_CLAVE_FIRMA: 'corta' }),
    ).toThrow(/demasiado corta/);
  });
});

describe('valores por defecto y validación', () => {
  it('sin proveedores declarados usa los de memoria, que no necesitan servidor', () => {
    const configuracion = leerConfiguracion(entorno());
    expect(configuracion.correo.proveedor).toBe('memoria');
    expect(configuracion.senal.proveedor).toBe('memoria');
    expect(configuracion.puerto).toBe(4010);
    expect(configuracion.validezHoras).toBe(72);
  });

  it('acepta los proveedores de verdad', () => {
    const configuracion = leerConfiguracion(
      entorno({ AIW_CORREO_PROVEEDOR: 'smtp', AIW_SENAL_PROVEEDOR: 'temporal' }),
    );
    expect(configuracion.correo.proveedor).toBe('smtp');
    expect(configuracion.senal.proveedor).toBe('temporal');
  });

  it('rechaza un proveedor inventado y enumera los que admite', () => {
    expect(() => leerConfiguracion(entorno({ AIW_CORREO_PROVEEDOR: 'paloma' }))).toThrow(
      /memoria o smtp/,
    );
    expect(() => leerConfiguracion(entorno({ AIW_SENAL_PROVEEDOR: 'grito' }))).toThrow(
      /memoria o temporal/,
    );
  });

  it('rechaza un número que no lo es o que no es positivo', () => {
    expect(() => leerConfiguracion(entorno({ AIW_APROBACION_PUERTO: 'ocho' }))).toThrow(
      /mayor que cero/,
    );
    expect(() => leerConfiguracion(entorno({ AIW_APROBACION_VALIDEZ_HORAS: '0' }))).toThrow(
      /mayor que cero/,
    );
  });

  it('el TLS de SMTP está apagado salvo que se encienda', () => {
    expect(leerConfiguracion(entorno()).correo.smtp.seguro).toBe(false);
    expect(leerConfiguracion(entorno({ AIW_CORREO_SMTP_TLS: '1' })).correo.smtp.seguro).toBe(true);
  });
});

describe('la configuración no filtra la clave', () => {
  it('ni al serializar, ni al inspeccionar, ni al interpolar', () => {
    const configuracion = leerConfiguracion(
      entorno({ AIW_CORREO_SMTP_CONTRASENA: randomBytes(16).toString('hex') }),
    );
    const serializada = JSON.stringify(configuracion);
    const inspeccionada = inspect(configuracion, { depth: 10 });

    expect(serializada).not.toContain(CLAVE);
    expect(inspeccionada).not.toContain(CLAVE);
    expect(`${configuracion.claveDeFirma}`).not.toContain(CLAVE);
    expect(serializada).not.toContain(configuracion.correo.smtp.contrasena.revelar());
  });
});
