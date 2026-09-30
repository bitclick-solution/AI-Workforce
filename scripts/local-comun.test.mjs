// Pruebas de la lógica que depende de la plataforma en local-comun.mjs (fallos 1,
// 2 y 6 de «demo local en Windows»): resolución de pnpm, parada del árbol de
// procesos y prioridad del entorno. `process.platform` es siempre inyectable,
// así que se prueban los dos sentidos (Windows y POSIX) sin necesitar Windows.
import { describe, expect, it, vi } from 'vitest';

import {
  comandoPnpm,
  entornoDeProceso,
  pararArbolDeProcesos,
  separarDelPadre,
} from './local-comun.mjs';

describe('comandoPnpm', () => {
  it('en Linux o macOS lanza pnpm tal cual, sin shell', () => {
    expect(comandoPnpm(['--version'], { plataforma: 'linux' })).toEqual({
      mandato: 'pnpm',
      argumentos: ['--version'],
      opciones: {},
    });
    expect(comandoPnpm(['--filter', '@aiw/api', 'dev'], { plataforma: 'darwin' }).opciones).toEqual(
      {},
    );
  });

  it('en Windows pide shell: true y cita los argumentos con espacios o comillas', () => {
    const resolucion = comandoPnpm(['--filter', '@aiw/api', 'dev'], { plataforma: 'win32' });
    expect(resolucion.mandato).toBe('pnpm');
    expect(resolucion.opciones).toEqual({ shell: true });
    expect(resolucion.argumentos).toEqual(['--filter', '@aiw/api', 'dev']);

    const conEspacio = comandoPnpm(['--filter', 'C:\\Programas con espacio\\app'], {
      plataforma: 'win32',
    });
    expect(conEspacio.argumentos[1]).toBe('"C:\\Programas con espacio\\app"');
  });
});

describe('separarDelPadre', () => {
  it('en Windows con shell (pnpm ahí) no se separa: perdía la salida del hijo (fallo tras el #50)', () => {
    expect(separarDelPadre('win32', { shell: true })).toBe(false);
  });

  it('en Windows sin shell (un .exe nativo) sí se separa, como siempre', () => {
    expect(separarDelPadre('win32', {})).toBe(true);
  });

  it('fuera de Windows siempre se separa, lleve shell o no', () => {
    expect(separarDelPadre('linux', {})).toBe(true);
    expect(separarDelPadre('darwin', { shell: true })).toBe(true);
  });
});

describe('pararArbolDeProcesos', () => {
  it('en POSIX manda SIGTERM al grupo (pid negativo)', () => {
    const matar = vi.fn();
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'linux', matar });
    expect(matar).toHaveBeenCalledWith(-4242, 'SIGTERM');
    expect(resultado).toEqual({ parado: true });
  });

  it('en POSIX, un pid que ya no existe (ESRCH) cuenta como parado', () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('no existe'), { code: 'ESRCH' });
    });
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'linux', matar });
    expect(resultado).toEqual({ parado: true });
  });

  it('en POSIX, un fallo real se dice y no se da por parado', () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('permiso denegado'), { code: 'EPERM' });
    });
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'linux', matar });
    expect(resultado).toEqual({ parado: false, motivo: 'permiso denegado' });
  });

  it('en Windows llama a taskkill /PID <pid> /T /F (fallo 1: kill(-pid) no para nada ahí)', () => {
    const ejecutar = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'win32', ejecutar });
    expect(ejecutar).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '4242', '/T', '/F'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(resultado).toEqual({ parado: true });
  });

  it('en Windows, un pid que taskkill no encuentra cuenta como parado', () => {
    const ejecutar = vi.fn(() => ({
      status: 128,
      stdout: '',
      stderr: 'ERROR: The process "4242" not found.',
    }));
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'win32', ejecutar });
    expect(resultado).toEqual({ parado: true });
  });

  it('en Windows, un fallo real de taskkill se dice y no se da por parado', () => {
    const ejecutar = vi.fn(() => ({ status: 1, stdout: '', stderr: 'acceso denegado' }));
    const resultado = pararArbolDeProcesos(4242, { plataforma: 'win32', ejecutar });
    expect(resultado).toEqual({ parado: false, motivo: 'acceso denegado' });
  });
});

describe('entornoDeProceso', () => {
  it('el entorno del proceso manda sobre el .env, y lo calculado manda sobre los dos (fallo 6)', () => {
    const antes = process.env.AIW_AUX_PRUEBA;
    process.env.AIW_AUX_PRUEBA = 'del-proceso';
    try {
      const entorno = entornoDeProceso(
        { AIW_AUX_PRUEBA: 'del-env', AIW_SOLO_EN_ENV: 'solo-env' },
        { AIW_AUX_PRUEBA: 'calculado' },
      );
      expect(entorno.AIW_AUX_PRUEBA).toBe('calculado');
      expect(entorno.AIW_SOLO_EN_ENV).toBe('solo-env');
    } finally {
      if (antes === undefined) delete process.env.AIW_AUX_PRUEBA;
      else process.env.AIW_AUX_PRUEBA = antes;
    }
  });

  it('sin nada calculado, el entorno del proceso ya gana al .env', () => {
    const antes = process.env.AIW_AUX_PRUEBA2;
    process.env.AIW_AUX_PRUEBA2 = 'del-proceso';
    try {
      const entorno = entornoDeProceso({ AIW_AUX_PRUEBA2: 'del-env' });
      expect(entorno.AIW_AUX_PRUEBA2).toBe('del-proceso');
    } finally {
      if (antes === undefined) delete process.env.AIW_AUX_PRUEBA2;
      else process.env.AIW_AUX_PRUEBA2 = antes;
    }
  });
});
