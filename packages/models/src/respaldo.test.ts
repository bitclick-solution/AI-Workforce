import { describe, expect, it } from 'vitest';

import { completarConRespaldo, decidirRespaldo } from './respaldo.js';
import type { PuertoDeModelo, RespuestaDeModelo } from './puerto.js';

function puertoQueResponde(
  respuesta: RespuestaDeModelo,
  modelo = respuesta.modelo,
): PuertoDeModelo {
  return {
    modelo,
    plataforma: 'bedrock-eu',
    async completar<T>() {
      return { ...respuesta, modelo } as RespuestaDeModelo<T>;
    },
  };
}

const OK: RespuestaDeModelo = {
  tipo: 'ok',
  texto: 'listo',
  tokens: { entrada: 10, salida: 5 },
  modelo: 'sonnet5',
};

const RECHAZO: RespuestaDeModelo = {
  tipo: 'rechazo',
  categoria: 'cyber',
  explicacion: null,
  tokens: { entrada: 10, salida: 0 },
  modelo: 'sonnet5',
};

describe('decidirRespaldo (ADR-018)', () => {
  it('sin rechazo, no hay respaldo que decidir', () => {
    expect(decidirRespaldo({ modelo: 'sonnet5', modeloRespaldo: 'haiku45' }, OK)).toBeNull();
  });

  it('con rechazo y respaldo configurado, decide el papel de respaldo', () => {
    expect(decidirRespaldo({ modelo: 'sonnet5', modeloRespaldo: 'haiku45' }, RECHAZO)).toBe(
      'haiku45',
    );
  });

  it('sin respaldo configurado, el rechazo se queda sin segundo intento', () => {
    expect(decidirRespaldo({ modelo: 'sonnet5', modeloRespaldo: null }, RECHAZO)).toBeNull();
  });

  it('un respaldo igual al principal no cuenta como segundo intento', () => {
    expect(decidirRespaldo({ modelo: 'sonnet5', modeloRespaldo: 'sonnet5' }, RECHAZO)).toBeNull();
  });
});

describe('completarConRespaldo', () => {
  it('sin rechazo, nunca toca el puerto de respaldo', async () => {
    const principal = puertoQueResponde(OK);
    let llamadoRespaldo = false;
    const resultado = await completarConRespaldo(
      { modelo: 'sonnet5', modeloRespaldo: 'haiku45' },
      principal,
      () => {
        llamadoRespaldo = true;
        return puertoQueResponde(OK);
      },
      { clasePaso: 'negocio', mensajes: [{ rol: 'user', contenido: 'x' }] },
    );
    expect(resultado.sirvioRespaldo).toBe(false);
    expect(resultado.resultado).toEqual(OK);
    expect(llamadoRespaldo).toBe(false);
  });

  it('con rechazo y respaldo, ejecuta el respaldo con el cliente, no el servidor', async () => {
    const principal = puertoQueResponde(RECHAZO);
    const resultado = await completarConRespaldo(
      { modelo: 'sonnet5', modeloRespaldo: 'haiku45' },
      principal,
      (papel) => puertoQueResponde(OK, papel),
      { clasePaso: 'decision_escritura', mensajes: [{ rol: 'user', contenido: 'x' }] },
    );
    expect(resultado.sirvioRespaldo).toBe(true);
    expect(resultado.rechazoPrincipal).toEqual(RECHAZO);
    expect(resultado.resultado).toEqual({ ...OK, modelo: 'haiku45' });
  });

  it('rechazo sin respaldo configurado: falla como paso no reintentable, sin segundo intento', async () => {
    const principal = puertoQueResponde(RECHAZO);
    let llamadoRespaldo = false;
    const resultado = await completarConRespaldo(
      { modelo: 'sonnet5', modeloRespaldo: null },
      principal,
      () => {
        llamadoRespaldo = true;
        return puertoQueResponde(OK);
      },
      { clasePaso: 'conciliacion', mensajes: [{ rol: 'user', contenido: 'x' }] },
    );
    expect(resultado.sirvioRespaldo).toBe(false);
    expect(resultado.resultado).toEqual(RECHAZO);
    expect(llamadoRespaldo).toBe(false);
  });
});
