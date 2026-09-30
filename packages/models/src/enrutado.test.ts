import { describe, expect, it } from 'vitest';

import { Enrutador, ProveedorNoRegistrado, enrutadoModelo, enrutadorDePrueba } from './enrutado.js';
import { enrutadorDeGuiones } from './guiones/index.js';
import type { PuertoDeModelo } from './puerto.js';

const puertoFalso = (modelo: string, plataforma = 'bedrock-eu'): PuertoDeModelo => ({
  modelo,
  plataforma,
  completar: () => Promise.reject(new Error('no se llama en esta prueba')),
});

describe('enrutado del puesto', () => {
  it('no cae a ningún modelo por defecto: un enrutado vacío falla en voz alta', () => {
    expect(() => enrutadoModelo.parse({})).toThrow(/papel|proveedor/);
    expect(() => enrutadorDeGuiones().resolverPaso({})).toThrow(/enrutado del puesto no es válido/);
    expect(() => enrutadorDeGuiones().resolverPaso(undefined)).toThrow(/no es válido/);
  });

  it('sigue aceptando el enrutado explícito de los puestos ya sembrados', () => {
    const paso = enrutadorDeGuiones().resolverPaso({
      proveedor: 'prueba',
      modelo: 'deterministico',
    });
    expect(paso).toMatchObject({ via: 'modelo', proveedor: 'prueba', modeloId: 'deterministico' });
  });

  it('exige que proveedor y modelo vayan juntos', () => {
    expect(() => enrutadoModelo.parse({ proveedor: 'prueba' })).toThrow();
    expect(() => enrutadoModelo.parse({ modelo: 'deterministico' })).toThrow();
  });

  it('enruta por papel al guion de prueba cuando el proceso eligió prueba', () => {
    const paso = enrutadorDeGuiones().resolverPaso({
      papel: 'opus5',
      modeloDePrueba: 'deterministico-conciliacion',
    });
    expect(paso).toMatchObject({
      via: 'modelo',
      proveedor: 'prueba',
      modeloId: 'deterministico-conciliacion',
    });
  });

  it('con prueba elegido, un papel sin modeloDePrueba falla: no adivina qué guion lo contesta', () => {
    expect(() => enrutadorDePrueba(() => ({}) as never).resolverPaso({ papel: 'sonnet5' })).toThrow(
      /modeloDePrueba/,
    );
  });

  it('un enrutado por papel sin proveedor elegido en el proceso falla', () => {
    const enrutador = new Enrutador().registrarPuerto('bedrock-ue', 'bedrock-eu', (papel) =>
      puertoFalso(papel),
    );
    expect(() => enrutador.resolverPaso({ papel: 'sonnet5' })).toThrow(/AIW_PROVEEDOR_MODELOS/);
  });

  it('enruta por papel al proveedor real elegido, sin registrar el de prueba', () => {
    const enrutador = new Enrutador()
      .registrarPuerto('bedrock-ue', 'bedrock-eu', (papel) => puertoFalso(`bedrock:${papel}`))
      .elegir({ principal: 'bedrock-ue' });
    const paso = enrutador.resolverPaso({ papel: 'sonnet5', papelRespaldo: 'haiku45' });
    expect(paso).toMatchObject({
      via: 'puerto',
      proveedor: 'bedrock-ue',
      papel: 'sonnet5',
      tarifasEsperadas: [
        { proveedor: 'anthropic', modelo: 'claude-sonnet-4-6', plataforma: 'bedrock-eu' },
        { proveedor: 'anthropic', modelo: 'claude-haiku-4-5', plataforma: 'bedrock-eu' },
      ],
    });
    expect(enrutador.proveedores).toEqual(['bedrock-ue']);
  });

  it('un puesto sembrado con prueba falla con la lista de lo registrado si el proceso eligió Bedrock', () => {
    const enrutador = new Enrutador()
      .registrarPuerto('bedrock-ue', 'bedrock-eu', (papel) => puertoFalso(papel))
      .elegir({ principal: 'bedrock-ue' });
    expect(() => enrutador.resolverPaso({ proveedor: 'prueba', modelo: 'deterministico' })).toThrow(
      ProveedorNoRegistrado,
    );
    expect(() => enrutador.resolverPaso({ proveedor: 'prueba', modelo: 'deterministico' })).toThrow(
      /Registrados: bedrock-ue/,
    );
  });

  it('resolver, la forma del AI SDK, rechaza un puesto que va a un proveedor real', () => {
    const enrutador = new Enrutador()
      .registrarPuerto('bedrock-ue', 'bedrock-eu', (papel) => puertoFalso(papel))
      .elegir({ principal: 'bedrock-ue' });
    expect(() => enrutador.resolver({ papel: 'opus5' })).toThrow(/resolverPaso/);
  });
});
