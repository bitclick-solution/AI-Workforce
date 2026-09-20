/**
 * Reintentos: el camino de error que la definición de hecho exige probar.
 *
 * La espera se inyecta, así que estas pruebas no duermen: comprueban con qué
 * retardos se habría llamado, que es lo que de verdad importa.
 */
import { describe, expect, it, vi } from 'vitest';

import { ErrorDefinitivo, reintentar, textoDeError } from './reintentos.js';

function dormirFalso(registro: number[]) {
  return async (ms: number): Promise<void> => {
    registro.push(ms);
    return Promise.resolve();
  };
}

describe('reintentar', () => {
  it('no reintenta lo que sale bien la primera vez', async () => {
    const operacion = vi.fn(async () => Promise.resolve('listo'));
    const resultado = await reintentar(operacion);
    expect(resultado).toEqual({ valor: 'listo', intentos: 1 });
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it('falla dos veces y acierta a la tercera, con espera creciente', async () => {
    const esperas: number[] = [];
    let llamadas = 0;
    const resultado = await reintentar(
      async () => {
        llamadas += 1;
        if (llamadas < 3) throw new Error('SMTP no responde');
        return Promise.resolve('enviado');
      },
      { intentos: 3, retardoMs: 100, dormir: dormirFalso(esperas) },
    );
    expect(resultado).toEqual({ valor: 'enviado', intentos: 3 });
    expect(esperas).toEqual([100, 200]);
  });

  it('agota los intentos y lanza el último error', async () => {
    const esperas: number[] = [];
    await expect(
      reintentar(async () => Promise.reject(new Error('sigue cayendo')), {
        intentos: 3,
        retardoMs: 50,
        dormir: dormirFalso(esperas),
      }),
    ).rejects.toThrow('sigue cayendo');
    // Dos esperas para tres intentos: no se espera después del último.
    expect(esperas).toEqual([50, 100]);
  });

  it('avisa de cada intento fallido y dice si quedan más', async () => {
    const avisos: { intento: number; quedan: boolean }[] = [];
    await expect(
      reintentar(async () => Promise.reject(new Error('no')), {
        intentos: 3,
        retardoMs: 1,
        dormir: async () => Promise.resolve(),
        alFallar: (_error, intento, quedan) => {
          avisos.push({ intento, quedan });
        },
      }),
    ).rejects.toThrow();
    expect(avisos).toEqual([
      { intento: 1, quedan: true },
      { intento: 2, quedan: true },
      { intento: 3, quedan: false },
    ]);
  });

  it('no reintenta un error definitivo, y lo avisa una sola vez', async () => {
    const operacion = vi.fn(async () => Promise.reject(new ErrorDefinitivo('el buzón no existe')));
    const avisos: number[] = [];
    await expect(
      reintentar(operacion, {
        intentos: 5,
        retardoMs: 1,
        alFallar: (_error, intento) => {
          avisos.push(intento);
        },
      }),
    ).rejects.toThrow('el buzón no existe');
    expect(operacion).toHaveBeenCalledTimes(1);
    expect(avisos).toEqual([1]);
  });

  it('respeta un criterio propio de error definitivo', async () => {
    const operacion = vi.fn(async () => Promise.reject(new Error('550 buzón inexistente')));
    await expect(
      reintentar(operacion, {
        intentos: 4,
        esDefinitivo: (error) => error instanceof Error && error.message.startsWith('550'),
      }),
    ).rejects.toThrow('550');
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it('con un solo intento no reintenta nada', async () => {
    const operacion = vi.fn(async () => Promise.reject(new Error('uno y fuera')));
    await expect(reintentar(operacion, { intentos: 1 })).rejects.toThrow('uno y fuera');
    expect(operacion).toHaveBeenCalledTimes(1);
  });

  it('pasa el número de intento a la operación', async () => {
    const vistos: number[] = [];
    await reintentar(
      async (intento) => {
        vistos.push(intento);
        if (intento < 2) throw new Error('otra vez');
        return Promise.resolve(intento);
      },
      { intentos: 3, retardoMs: 1, dormir: async () => Promise.resolve() },
    );
    expect(vistos).toEqual([1, 2]);
  });
});

describe('textoDeError', () => {
  it('resume el error sin volcar la pila', () => {
    expect(textoDeError(new TypeError('mal tipo'))).toBe('TypeError: mal tipo');
    expect(textoDeError('texto suelto')).toBe('texto suelto');
    expect(textoDeError({ raro: true })).toBe('error desconocido');
  });
});
