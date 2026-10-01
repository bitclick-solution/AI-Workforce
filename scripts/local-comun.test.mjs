// Pruebas de la lógica que depende de la plataforma en local-comun.mjs (fallos 1,
// 2 y 6 de «demo local en Windows», y criterio 2 y 3 del segundo seguimiento del
// Probador): resolución de pnpm, parada del árbol de procesos (y del puerto que
// deja huérfano), reconocimiento de servicios ya vivos y prioridad del entorno.
// `process.platform` es siempre inyectable, así que se prueban los dos sentidos
// (Windows y POSIX) sin necesitar Windows.
import { describe, expect, it, vi } from 'vitest';

import {
  comandoPnpm,
  entornoDeProceso,
  extraerSemillaSala,
  matarPid,
  pararArbolDeProcesos,
  pararServicio,
  pidsDeNetstat,
  pidsEnPuerto,
  procesoVivo,
  separarDelPadre,
  servicioVivo,
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

describe('procesoVivo', () => {
  it('en POSIX, señal 0 sin lanzar cuenta como vivo', () => {
    const matar = vi.fn();
    expect(procesoVivo(4242, { plataforma: 'linux', matar })).toBe(true);
    expect(matar).toHaveBeenCalledWith(4242, 0);
  });

  it('en POSIX, ESRCH cuenta como no vivo', () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('no existe'), { code: 'ESRCH' });
    });
    expect(procesoVivo(4242, { plataforma: 'linux', matar })).toBe(false);
  });

  it('en POSIX, un error que no es ESRCH (p. ej. EPERM) cuenta como vivo: existe pero no es nuestro', () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('permiso denegado'), { code: 'EPERM' });
    });
    expect(procesoVivo(4242, { plataforma: 'linux', matar })).toBe(true);
  });

  it('en Windows, tasklist con el pid en la salida cuenta como vivo', () => {
    const ejecutar = vi.fn(() => ({
      status: 0,
      stdout: 'node.exe                     4242 Console                    1     50.000 K',
    }));
    expect(procesoVivo(4242, { plataforma: 'win32', ejecutar })).toBe(true);
  });

  it('en Windows, tasklist sin ese pid cuenta como no vivo', () => {
    const ejecutar = vi.fn(() => ({
      status: 0,
      stdout: 'INFO: No tasks are running which match the specified criteria.',
    }));
    expect(procesoVivo(4242, { plataforma: 'win32', ejecutar })).toBe(false);
  });
});

describe('servicioVivo', () => {
  it('sin puerto (el worker), basta con que el pid esté vivo', async () => {
    const matar = vi.fn();
    await expect(
      servicioVivo({ pid: 4242, puerto: undefined }, { plataforma: 'linux', matar }),
    ).resolves.toBe(true);
  });

  it('con puerto (api o web), hace falta que el pid esté vivo y el puerto siga escuchando', async () => {
    const matar = vi.fn();
    const comprobarPuerto = vi.fn().mockResolvedValue(true);
    await expect(
      servicioVivo({ pid: 4242, puerto: '3002' }, { plataforma: 'linux', matar, comprobarPuerto }),
    ).resolves.toBe(true);
    expect(comprobarPuerto).toHaveBeenCalledWith('3002');
  });

  it('con puerto pero ya sin nadie escuchando, no cuenta como vivo', async () => {
    const matar = vi.fn();
    const comprobarPuerto = vi.fn().mockResolvedValue(false);
    await expect(
      servicioVivo({ pid: 4242, puerto: '3002' }, { plataforma: 'linux', matar, comprobarPuerto }),
    ).resolves.toBe(false);
  });

  it('con el pid ya muerto, no hace falta mirar el puerto', async () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('no existe'), { code: 'ESRCH' });
    });
    const comprobarPuerto = vi.fn();
    await expect(
      servicioVivo({ pid: 4242, puerto: '3002' }, { plataforma: 'linux', matar, comprobarPuerto }),
    ).resolves.toBe(false);
    expect(comprobarPuerto).not.toHaveBeenCalled();
  });
});

describe('extraerSemillaSala', () => {
  it('extrae cola y tenantId de la línea SEMILLA_SALA', () => {
    expect(extraerSemillaSala('algo\nSEMILLA_SALA tenant=abc cola=aiw-demo\nmás')).toEqual({
      cola: 'aiw-demo',
      tenantId: 'abc',
    });
  });

  it('sin la línea SEMILLA_SALA, undefined', () => {
    expect(extraerSemillaSala('arrancando...')).toBeUndefined();
  });
});

describe('pidsDeNetstat', () => {
  const SALIDA = [
    '',
    '  Proto  Direcciones locales    Direcciones remotas   Estado',
    '  TCP    0.0.0.0:3000           0.0.0.0:0             LISTENING       9999',
    '  TCP    127.0.0.1:3000         127.0.0.1:54321       ESTABLISHED     8888',
    '  TCP    [::]:3000              [::]:0                LISTENING       9999',
    '  TCP    0.0.0.0:3002           0.0.0.0:0             LISTENING       7777',
    '',
  ].join('\r\n');

  it('recoge los pids en LISTENING de ese puerto, sin duplicar', () => {
    expect(pidsDeNetstat(SALIDA, 3000)).toEqual([9999]);
  });

  it('no confunde un puerto con otro', () => {
    expect(pidsDeNetstat(SALIDA, 3002)).toEqual([7777]);
    expect(pidsDeNetstat(SALIDA, 4000)).toEqual([]);
  });

  it('ignora las líneas que no están escuchando', () => {
    expect(pidsDeNetstat(SALIDA, 3000)).not.toContain(8888);
  });
});

describe('pidsEnPuerto', () => {
  it('en Windows llama a netstat y parsea su salida', () => {
    const ejecutar = vi.fn(() => ({
      status: 0,
      stdout: '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    9999',
    }));
    expect(pidsEnPuerto(3000, { plataforma: 'win32', ejecutar })).toEqual([9999]);
    expect(ejecutar).toHaveBeenCalledWith(
      'netstat',
      ['-ano', '-p', 'TCP'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('en POSIX llama a lsof con el puerto', () => {
    const ejecutar = vi.fn(() => ({ status: 0, stdout: '9999\n8888\n' }));
    expect(pidsEnPuerto(3000, { plataforma: 'linux', ejecutar })).toEqual([9999, 8888]);
    expect(ejecutar).toHaveBeenCalledWith(
      'lsof',
      ['-ti', 'tcp:3000', '-sTCP:LISTEN'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('si la herramienta no está (o falla), no finge que el puerto está libre: devuelve []', () => {
    const ejecutar = vi.fn(() => ({ status: 1, error: new Error('ENOENT') }));
    expect(pidsEnPuerto(3000, { plataforma: 'linux', ejecutar })).toEqual([]);
  });
});

describe('matarPid', () => {
  it('en Windows manda taskkill /PID <pid> /F, sin /T (ya no es el árbol, es el pid concreto)', () => {
    const ejecutar = vi.fn(() => ({ status: 0 }));
    expect(matarPid(9999, { plataforma: 'win32', ejecutar })).toBe(true);
    expect(ejecutar).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '9999', '/F'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('en POSIX manda SIGKILL al pid concreto', () => {
    const matar = vi.fn();
    expect(matarPid(9999, { plataforma: 'linux', matar })).toBe(true);
    expect(matar).toHaveBeenCalledWith(9999, 'SIGKILL');
  });
});

describe('pararServicio', () => {
  it('sin puerto, basta con que el árbol pare (el worker no escucha nada)', async () => {
    const matar = vi.fn();
    const resultado = await pararServicio(
      { pid: 4242, puerto: undefined },
      { plataforma: 'linux', matar },
    );
    expect(resultado).toEqual({ parado: true });
  });

  it('si el árbol ya falla, ni mira el puerto', async () => {
    const matar = vi.fn(() => {
      throw Object.assign(new Error('permiso denegado'), { code: 'EPERM' });
    });
    const comprobarPuerto = vi.fn();
    const resultado = await pararServicio(
      { pid: 4242, puerto: '3000' },
      { plataforma: 'linux', matar, comprobarPuerto },
    );
    expect(resultado).toEqual({ parado: false, motivo: 'permiso denegado' });
    expect(comprobarPuerto).not.toHaveBeenCalled();
  });

  it('con puerto y ya libre tras el árbol, parado sin más (el caso normal)', async () => {
    const ejecutar = vi.fn(() => ({ status: 0 }));
    const comprobarPuerto = vi.fn().mockResolvedValue(false);
    const resultado = await pararServicio(
      { pid: 4242, puerto: '3000' },
      { plataforma: 'win32', ejecutar, comprobarPuerto },
    );
    expect(resultado).toEqual({ parado: true });
  });

  it('da un margen a que el puerto se libere solo antes de rematar: SIGTERM/taskkill no esperan a que el proceso termine de verdad (fallo real en la CI tras este seguimiento)', async () => {
    const ejecutar = vi.fn(() => ({ status: 0 })); // taskkill de la raíz
    // Ocupado las dos primeras veces (la carrera: el proceso aún no ha cerrado
    // el socket), libre a la tercera — sin necesitar esperar de verdad.
    const comprobarPuerto = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const dormir = vi.fn().mockResolvedValue(undefined);
    const resultado = await pararServicio(
      { pid: 4242, puerto: 3000 },
      { plataforma: 'win32', ejecutar, comprobarPuerto, dormir },
    );
    expect(resultado).toEqual({ parado: true });
    expect(dormir).toHaveBeenCalledTimes(2);
    // Solo el taskkill de la raíz: nunca llegó a necesitar identificar ni rematar nada.
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('en Windows, taskkill /T dice parado pero el puerto sigue escuchando pasado el margen: remata a quien lo tiene (fallo real tras el #54)', async () => {
    const ejecutar = vi
      .fn()
      // taskkill /PID 4242 /T /F (la raíz)
      .mockReturnValueOnce({ status: 0 })
      // netstat -ano -p TCP
      .mockReturnValueOnce({
        status: 0,
        stdout: '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    9999',
      })
      // taskkill /PID 9999 /F (el nieto huérfano)
      .mockReturnValueOnce({ status: 0 });
    const comprobarPuerto = vi.fn().mockResolvedValue(true);
    const resultado = await pararServicio(
      { pid: 4242, puerto: 3000 },
      { plataforma: 'win32', ejecutar, comprobarPuerto, intentos: 0 },
    );
    expect(resultado).toEqual({ parado: true });
    expect(ejecutar).toHaveBeenNthCalledWith(
      3,
      'taskkill',
      ['/PID', '9999', '/F'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
  });

  it('si el puerto sigue ocupado pasado el margen y no se identifica a nadie, lo dice y no lo da por parado', async () => {
    const ejecutar = vi
      .fn()
      .mockReturnValueOnce({ status: 0 }) // taskkill de la raíz
      .mockReturnValueOnce({ status: 1, error: new Error('ENOENT') }); // netstat ausente
    const comprobarPuerto = vi.fn().mockResolvedValue(true);
    const resultado = await pararServicio(
      { pid: 4242, puerto: 3000 },
      { plataforma: 'win32', ejecutar, comprobarPuerto, intentos: 0 },
    );
    expect(resultado.parado).toBe(false);
    expect(resultado.motivo).toMatch(/sigue escuchando/);
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
