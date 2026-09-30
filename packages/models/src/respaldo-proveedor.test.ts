import { describe, expect, it } from 'vitest';

import { crearPuertoEnrutado } from './respaldo.js';
import type { PeticionDeModelo, PuertoDeModelo, RespuestaDeModelo } from './puerto.js';

const peticion: PeticionDeModelo = {
  clasePaso: 'negocio',
  mensajes: [{ rol: 'user', contenido: 'hola' }],
};

function ok(modelo: string, entrada = 100): RespuestaDeModelo {
  return { tipo: 'ok', texto: modelo, tokens: { entrada, salida: 10, entradaCache: 0 }, modelo };
}

function rechazo(modelo: string): RespuestaDeModelo {
  return {
    tipo: 'rechazo',
    categoria: 'general_harms',
    explicacion: null,
    tokens: { entrada: 90, salida: 0, entradaCache: 0 },
    modelo,
  };
}

/** Un proveedor cuyo puerto de cada papel contesta lo que diga `guion`. */
function proveedor(
  nombre: string,
  plataforma: string,
  guion: (papel: string) => RespuestaDeModelo | Error,
) {
  const llamadas: string[] = [];
  return {
    llamadas,
    proveedor: nombre,
    puerto: (papel: string): PuertoDeModelo => ({
      modelo: `${nombre}/${papel}`,
      plataforma,
      completar: async <T>() => {
        llamadas.push(papel);
        const respuesta = guion(papel);
        if (respuesta instanceof Error) throw respuesta;
        return respuesta as RespuestaDeModelo<T>;
      },
    }),
  };
}

describe('puerto enrutado: respaldo de proveedor y de papel', () => {
  it('sirve con el principal cuando responde', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', (papel) => ok(papel));
    const respaldo = proveedor('vertex-ue', 'vertex-eu', (papel) => ok(papel));
    const puerto = crearPuertoEnrutado({ papel: 'sonnet5', principal, respaldo });

    const respuesta = await puerto.completar(peticion);

    expect(respuesta.sirvio).toEqual({
      proveedor: 'bedrock-ue',
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      modeloId: 'bedrock-ue/sonnet5',
    });
    expect(respuesta.intentosFallidos).toEqual([]);
    expect(respaldo.llamadas).toEqual([]);
  });

  it('un error del proveedor principal pasa la petición al proveedor de respaldo, con el mismo papel', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', () => new Error('403 sin cuota'));
    const respaldo = proveedor('vertex-ue', 'vertex-eu', (papel) => ok(papel));
    const puerto = crearPuertoEnrutado({ papel: 'opus5', principal, respaldo });

    const respuesta = await puerto.completar(peticion);

    expect(respuesta.sirvio).toMatchObject({
      proveedor: 'vertex-ue',
      papel: 'opus5',
      plataforma: 'vertex-eu',
    });
    expect(respuesta.intentosFallidos).toMatchObject([
      { proveedor: 'bedrock-ue', motivo: 'error', detalle: '403 sin cuota' },
    ]);
    expect(principal.llamadas).toEqual(['opus5']);
    expect(respaldo.llamadas).toEqual(['opus5']);
  });

  it('si el respaldo también falla, lanza el error del principal con el del respaldo anotado', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', () => new Error('403 sin cuota'));
    const respaldo = proveedor('vertex-ue', 'vertex-eu', () => new Error('sin proyecto'));
    const puerto = crearPuertoEnrutado({ papel: 'sonnet5', principal, respaldo });

    await expect(puerto.completar(peticion)).rejects.toThrow(
      /403 sin cuota.*vertex-ue.*también falló: sin proyecto/,
    );
  });

  it('sin proveedor de respaldo, el error del principal se propaga para que Temporal reintente', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', () => new Error('red caída'));
    const puerto = crearPuertoEnrutado({ papel: 'sonnet5', principal });
    await expect(puerto.completar(peticion)).rejects.toThrow('red caída');
  });

  it('un rechazo del clasificador prueba el papel de respaldo del puesto y anota los tokens del rechazo', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', (papel) =>
      papel === 'sonnet5' ? rechazo(papel) : ok(papel),
    );
    const puerto = crearPuertoEnrutado({ papel: 'sonnet5', papelRespaldo: 'haiku45', principal });

    const respuesta = await puerto.completar(peticion);

    expect(respuesta.resultado.tipo).toBe('ok');
    expect(respuesta.sirvio.papel).toBe('haiku45');
    expect(respuesta.intentosFallidos).toMatchObject([
      { motivo: 'rechazo', papel: 'sonnet5', detalle: 'general_harms', tokens: { entrada: 90 } },
    ]);
    expect(principal.llamadas).toEqual(['sonnet5', 'haiku45']);
  });

  it('un rechazo sin papel de respaldo, o con el mismo papel, se devuelve como rechazo y no se reintenta', async () => {
    const sin = proveedor('bedrock-ue', 'bedrock-eu', (papel) => rechazo(papel));
    expect(
      (await crearPuertoEnrutado({ papel: 'sonnet5', principal: sin }).completar(peticion))
        .resultado.tipo,
    ).toBe('rechazo');
    expect(sin.llamadas).toEqual(['sonnet5']);

    const mismo = proveedor('bedrock-ue', 'bedrock-eu', (papel) => rechazo(papel));
    await crearPuertoEnrutado({
      papel: 'sonnet5',
      papelRespaldo: 'sonnet5',
      principal: mismo,
    }).completar(peticion);
    expect(mismo.llamadas).toEqual(['sonnet5']);
  });

  it('si el papel de respaldo también rechaza, devuelve ese rechazo con el primero anotado', async () => {
    const principal = proveedor('bedrock-ue', 'bedrock-eu', (papel) => rechazo(papel));
    const respuesta = await crearPuertoEnrutado({
      papel: 'opus5',
      papelRespaldo: 'sonnet5',
      principal,
    }).completar(peticion);
    expect(respuesta.resultado.tipo).toBe('rechazo');
    expect(respuesta.sirvio.papel).toBe('sonnet5');
    expect(respuesta.intentosFallidos).toHaveLength(1);
  });
});
