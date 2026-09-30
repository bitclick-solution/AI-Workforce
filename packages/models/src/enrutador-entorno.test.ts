import { afterEach, describe, expect, it } from 'vitest';

import { clienteSimulado } from './adaptadores/clientes.js';
import { enrutadorDesdeEntorno } from './enrutador-entorno.js';
import {
  iniciarServidorSimulado,
  respuestaDeErrorHttp,
  respuestaDeTexto,
  type ServidorSimulado,
} from './pruebas/index.js';

const PETICION = {
  clasePaso: 'negocio' as const,
  mensajes: [{ rol: 'user' as const, contenido: 'hola' }],
};

describe('enrutador del proceso desde el entorno', () => {
  const servidores: ServidorSimulado[] = [];
  afterEach(async () => {
    await Promise.all(servidores.splice(0).map((servidor) => servidor.cerrar()));
  });

  async function servidor(respuestas: unknown | unknown[]): Promise<ServidorSimulado> {
    const nuevo = await iniciarServidorSimulado(respuestas);
    servidores.push(nuevo);
    return nuevo;
  }

  it('elige el proveedor de prueba solo si el entorno lo escribe', () => {
    const enrutador = enrutadorDesdeEntorno({ AIW_PROVEEDOR_MODELOS: 'prueba' });
    expect(enrutador.eleccion).toEqual({ principal: 'prueba' });
    expect(enrutador.proveedores).toEqual(['prueba']);
  });

  it('sin variable no cae a prueba: exige las credenciales de Bedrock y nombra lo que falta', () => {
    const intento = () => enrutadorDesdeEntorno({ AIW_BEDROCK_REGION_UE: 'eu-north-1' });
    expect(intento).toThrow(/AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY/);
    expect(intento).toThrow(/AIW_PROVEEDOR_MODELOS=prueba/);
  });

  it('sin la región de la UE, falla con el nombre de la variable', () => {
    expect(() =>
      enrutadorDesdeEntorno({ AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' }),
    ).toThrow(/AIW_BEDROCK_REGION_UE/);
  });

  it('rechaza un proveedor que no existe y lista los admitidos', () => {
    expect(() => enrutadorDesdeEntorno({ AIW_PROVEEDOR_MODELOS: 'openai' })).toThrow(
      /vertex-ue, bedrock-ue, prueba/,
    );
    expect(() =>
      enrutadorDesdeEntorno({
        AIW_PROVEEDOR_MODELOS: 'prueba',
        AIW_PROVEEDOR_MODELOS_RESPALDO: 'prueba',
      }),
    ).not.toThrow();
  });

  it('el mensaje de error nunca trae el valor de una credencial', () => {
    const centinela = 'SECRETO-CENTINELA-123';
    try {
      enrutadorDesdeEntorno({
        AWS_SECRET_ACCESS_KEY: centinela,
        AIW_BEDROCK_REGION_UE: 'eu-north-1',
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(centinela);
    }
  });

  it('registra Bedrock como principal con el cliente y el adaptador de Modelos v1, y elige el respaldo', async () => {
    const bedrock = await servidor(respuestaDeTexto('desde bedrock'));
    const enrutador = enrutadorDesdeEntorno(
      { AIW_PROVEEDOR_MODELOS: 'bedrock-ue' },
      { clientes: { 'bedrock-ue': clienteSimulado(bedrock.url) } },
    );
    expect(enrutador.eleccion).toEqual({ principal: 'bedrock-ue', respaldo: 'vertex-ue' });

    const paso = enrutador.resolverPaso({ papel: 'haiku45' });
    if (paso.via !== 'puerto') throw new Error('debía ir por el puerto');
    const respuesta = await paso.puerto.completar(PETICION);

    expect(respuesta.sirvio).toMatchObject({
      proveedor: 'bedrock-ue',
      plataforma: 'bedrock-eu',
      modeloId: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    });
    expect((bedrock.peticiones[0]?.cuerpo as { model: string }).model).toBe(
      'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
  });

  it('el respaldo entra cuando el principal rechaza la llamada, y arrancar no exige sus credenciales', async () => {
    const bedrock = await servidor(respuestaDeErrorHttp(403, 'sin acceso al modelo'));
    const vertex = await servidor(respuestaDeTexto('desde vertex'));
    const enrutador = enrutadorDesdeEntorno(
      { AIW_PROVEEDOR_MODELOS: 'bedrock-ue', AIW_PROVEEDOR_MODELOS_RESPALDO: 'vertex-ue' },
      {
        clientes: {
          'bedrock-ue': clienteSimulado(bedrock.url),
          'vertex-ue': clienteSimulado(vertex.url),
        },
      },
    );

    const paso = enrutador.resolverPaso({ papel: 'sonnet5' });
    if (paso.via !== 'puerto') throw new Error('debía ir por el puerto');
    const respuesta = await paso.puerto.completar(PETICION);

    expect(respuesta.sirvio).toMatchObject({ proveedor: 'vertex-ue', plataforma: 'vertex-eu' });
    expect(respuesta.intentosFallidos[0]).toMatchObject({
      motivo: 'error',
      proveedor: 'bedrock-ue',
    });
    expect(respuesta.intentosFallidos[0]?.detalle).toMatch(/sin acceso al modelo/);
  });

  it('si el respaldo no está configurado, el fallo del principal lo dice al usar el respaldo, no al arrancar', async () => {
    const bedrock = await servidor(respuestaDeErrorHttp(403, 'sin acceso al modelo'));
    const enrutador = enrutadorDesdeEntorno(
      { AIW_PROVEEDOR_MODELOS: 'bedrock-ue' },
      { clientes: { 'bedrock-ue': clienteSimulado(bedrock.url) } },
    );
    const paso = enrutador.resolverPaso({ papel: 'sonnet5' });
    if (paso.via !== 'puerto') throw new Error('debía ir por el puerto');
    await expect(paso.puerto.completar(PETICION)).rejects.toThrow(
      /sin acceso al modelo.*AIW_VERTEX_REGION_UE/s,
    );
  });
});
