/**
 * El paso de modelo con un proveedor real, contra la base y un servidor que imita la
 * API de Mensajes de Bedrock (ni credenciales ni llamadas reales).
 *
 * Comprueba lo que la rebanada promete: el puesto enruta por papel, cada llamada suma
 * al contador con los tokens reales, el modelo servido y su plataforma, una llamada
 * sin tarifa no se hace, el respaldo entra ante un error y un rechazo, y nada se
 * cobra dos veces si Temporal repite la actividad.
 */
import { readFileSync } from 'node:fs';

import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS } from '@aiw/db/pruebas';
import { HERRAMIENTA_LISTAR } from '@aiw/connector-demo';
import { RUTA_CATALOGO_EJEMPLO, registrarTarifa, tarifasDelCatalogo } from '@aiw/ledger';
import { clienteSimulado, enrutadorDesdeEntorno } from '@aiw/models';
import {
  iniciarServidorSimulado,
  respuestaDeErrorHttp,
  respuestaDeRechazo,
  respuestaDeTexto,
  respuestaDeUsoDeHerramienta,
  type ServidorSimulado,
} from '@aiw/models/pruebas';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ejecutarBucle, type OperacionesDelBucle } from '../bucle/bucle.js';

import { crearContextoDeActividades } from '../actividades/contexto.js';
import { cargarTarifasDeBitclick } from '../bitclick/siembra.js';
import type { PeticionPasoModelo } from '../bucle/tipos.js';
import { montarParaPruebas, type MontajeDePruebas } from './montaje.js';

const ESQUEMA = {
  type: 'object',
  properties: { limite: { type: 'integer', minimum: 1 } },
  required: ['limite'],
};

describe.skipIf(!HAY_BASE_DE_DATOS)('paso de modelo · proveedor real', () => {
  const servidores: ServidorSimulado[] = [];
  const montajes: MontajeDePruebas[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
    await Promise.all(servidores.splice(0).map((servidor) => servidor.cerrar()));
  });

  async function servidor(respuestas: unknown | unknown[]): Promise<ServidorSimulado> {
    const nuevo = await iniciarServidorSimulado(respuestas);
    servidores.push(nuevo);
    return nuevo;
  }

  async function montar(
    bedrock: ServidorSimulado,
    opciones: { vertex?: ServidorSimulado; conTarifas?: boolean; papel?: object } = {},
  ) {
    const enrutador = enrutadorDesdeEntorno(
      { AIW_PROVEEDOR_MODELOS: 'bedrock-ue', AIW_PROVEEDOR_MODELOS_RESPALDO: 'vertex-ue' },
      {
        clientes: {
          'bedrock-ue': clienteSimulado(bedrock.url),
          ...(opciones.vertex ? { 'vertex-ue': clienteSimulado(opciones.vertex.url) } : {}),
        },
      },
    );
    const montaje = await montarParaPruebas({ nombre: 'Proveedor real', enrutador });
    montajes.push(montaje);
    const { tenantId } = montaje.semilla;

    await conTenant(
      montaje.cliente,
      tenantId,
      (tx) => tx`
        update puesto set enrutado_modelo = ${JSON.stringify(
          opciones.papel ?? { papel: 'sonnet5', papelRespaldo: 'haiku45' },
        )}::text::jsonb
        where tenant_id = ${tenantId} and id = ${montaje.semilla.cobros.puestoId}
      `,
    );
    if (opciones.conTarifas !== false) {
      const catalogo: unknown = JSON.parse(readFileSync(RUTA_CATALOGO_EJEMPLO, 'utf8'));
      for (const tarifa of tarifasDelCatalogo(catalogo).filter(
        (t) => t.proveedor === 'anthropic',
      )) {
        await conTenant(montaje.cliente, tenantId, (tx) => registrarTarifa(tx, tenantId, tarifa));
      }
    }
    return montaje;
  }

  function peticion(montaje: MontajeDePruebas, clave = 'clave-1'): PeticionPasoModelo {
    return {
      tenantId: montaje.semilla.tenantId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      tareaId: montaje.tareaId,
      sistema: 'Eres el agente de Cobros.',
      mensajes: [{ papel: 'usuario', texto: 'Revisa las facturas vencidas.' }],
      herramientas: [
        {
          nombre: HERRAMIENTA_LISTAR,
          descripcion: 'Lee las facturas vencidas.',
          tipo: 'lectura',
          claseAccion: 'facturas.leer',
          esquemaEntrada: ESQUEMA,
          conector: 'demo',
        },
      ],
      numeroPaso: 1,
      guardiasSalida: ['sin_secretos'],
      claveIdempotencia: clave,
    };
  }

  async function usos(montaje: MontajeDePruebas) {
    return conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<
        {
          proveedor: string;
          modelo: string;
          plataforma: string;
          tokens_entrada: string;
          tokens_salida: string;
          coste_euros: string;
        }[]
      >`
        select proveedor, modelo, plataforma, tokens_entrada, tokens_salida, coste_euros
        from uso_modelo where tarea_id = ${montaje.tareaId} order by creado_en
      `,
    ).then((filas) =>
      filas.map((fila) => ({
        ...fila,
        tokens_entrada: Number(fila.tokens_entrada),
        tokens_salida: Number(fila.tokens_salida),
      })),
    );
  }

  it('cobra con los tokens reales, el modelo servido y su plataforma, y devuelve lo que necesita el bucle', async () => {
    const bedrock = await servidor(
      respuestaDeUsoDeHerramienta(HERRAMIENTA_LISTAR, { limite: 5 }, { texto: 'Miro.' }),
    );
    const montaje = await montar(bedrock);

    const salida = await montaje.actividades.pasoModelo(peticion(montaje));

    expect(salida.llamadas).toEqual([
      { id: 'toolu_simulado_01', herramienta: HERRAMIENTA_LISTAR, argumentos: { limite: 5 } },
    ]);
    expect(salida.motivoFin).toBe('tool-calls');
    expect(salida.bloques).toHaveLength(2);
    const filas = await usos(montaje);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      proveedor: 'anthropic',
      modelo: 'claude-sonnet-4-6',
      plataforma: 'bedrock-eu',
      tokens_entrada: 150,
      tokens_salida: 30,
    });
    // 150 · 3,036 €/M + 30 · 15,18 €/M = 0,00091 €; el contador redondea a cuatro decimales
    expect(Number(filas[0]?.coste_euros)).toBeCloseTo(0.0009108, 3);
    expect(salida.costeEuros).toBeCloseTo(0.0009108, 3);
    expect(salida.gastadoEuros).toBeCloseTo(0.0009108, 3);
    // El modelo recibe el identificador del perfil UE de Bedrock, no el del papel.
    expect((bedrock.peticiones[0]?.cuerpo as { model: string }).model).toBe(
      'eu.anthropic.claude-sonnet-4-6',
    );
  });

  it('un reintento de Temporal del mismo paso no vuelve a cobrar', async () => {
    const bedrock = await servidor(respuestaDeTexto('Nada que reclamar.'));
    const montaje = await montar(bedrock);

    await montaje.actividades.pasoModelo(peticion(montaje));
    await montaje.actividades.pasoModelo(peticion(montaje));

    expect(await usos(montaje)).toHaveLength(1);
  });

  it('sin tarifa vigente no llama al modelo y falla sin reintento, diciendo qué falta', async () => {
    const bedrock = await servidor(respuestaDeTexto('no debería llamarse'));
    const montaje = await montar(bedrock, { conTarifas: false });

    await expect(montaje.actividades.pasoModelo(peticion(montaje))).rejects.toMatchObject({
      type: 'SinTarifa',
      nonRetryable: true,
      message: expect.stringContaining('anthropic/claude-sonnet-4-6 en bedrock-eu'),
    });
    expect(bedrock.peticiones).toHaveLength(0);
  });

  it('ante un error del proveedor principal sirve el de respaldo y cobra en su plataforma', async () => {
    const bedrock = await servidor(respuestaDeErrorHttp(403, 'sin acceso al modelo'));
    const vertex = await servidor(respuestaDeTexto('Desde Vertex.'));
    const montaje = await montar(bedrock, { vertex });

    const salida = await montaje.actividades.pasoModelo(peticion(montaje));

    expect(salida.texto).toBe('Desde Vertex.');
    expect(await usos(montaje)).toMatchObject([
      { proveedor: 'anthropic', modelo: 'claude-sonnet-5', plataforma: 'vertex-eu' },
    ]);
  });

  it('ante un rechazo prueba el papel de respaldo del puesto y cobra los dos intentos', async () => {
    let llamada = 0;
    const bedrock = await servidor(() => {
      llamada += 1;
      return llamada === 1 ? respuestaDeRechazo('general_harms') : respuestaDeTexto('Con Haiku.');
    });
    const montaje = await montar(bedrock);

    const salida = await montaje.actividades.pasoModelo(peticion(montaje));

    expect(salida.texto).toBe('Con Haiku.');
    expect(await usos(montaje)).toMatchObject([
      { modelo: 'claude-sonnet-4-6', tokens_entrada: 80, tokens_salida: 0 },
      { modelo: 'claude-haiku-4-5', tokens_entrada: 120, tokens_salida: 40 },
    ]);
    expect((bedrock.peticiones[1]?.cuerpo as { model: string }).model).toBe(
      'eu.anthropic.claude-haiku-4-5-20251001-v1:0',
    );
  });

  it('un rechazo sin respaldo que lo sirva es un paso fallido no reintentable, anotado y cobrado', async () => {
    const bedrock = await servidor(respuestaDeRechazo('general_harms'));
    const montaje = await montar(bedrock, { papel: { papel: 'sonnet5' } });

    await expect(montaje.actividades.pasoModelo(peticion(montaje))).rejects.toMatchObject({
      type: 'RechazoDelClasificador',
      nonRetryable: true,
    });
    expect(await usos(montaje)).toHaveLength(1);
    const pasos = await conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ resultado: string }[]>`
        select resultado from paso where tarea_id = ${montaje.tareaId}
      `,
    );
    expect(pasos).toEqual([{ resultado: 'rechazado' }]);
  });

  it('el bucle completo funciona en dos vueltas: la herramienta se ejecuta por el gateway y su resultado vuelve al modelo', async () => {
    // El modelo simulado pide la herramienta en la primera vuelta y, si ve su
    // resultado en la segunda, cierra con texto. Lo que la API real exige y aquí se
    // comprueba: el turno del asistente vuelve con su herramienta pedida y el
    // resultado, en un mensaje del usuario, contesta a ese mismo identificador.
    const bedrock = await servidor((cuerpo: unknown) => {
      const mensajes = (cuerpo as { messages: { content: unknown }[] }).messages;
      const ultimo = JSON.stringify(mensajes.at(-1)?.content);
      return ultimo.includes('tool_result')
        ? respuestaDeTexto('Hecho: revisé las facturas.')
        : respuestaDeUsoDeHerramienta(HERRAMIENTA_LISTAR, {}, { texto: 'Miro las facturas.' });
    });
    const montaje = await montar(bedrock);
    const actividades = montaje.actividades;
    const identidad = {
      tenantId: montaje.semilla.tenantId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      tareaId: montaje.tareaId,
    };
    await actividades.arrancarTarea({
      ...identidad,
      flujoTemporalId: 'prueba-proveedor-real',
      ejecucionTemporalId: 'sin-temporal',
    });
    const operaciones: OperacionesDelBucle = {
      leerContexto: () => actividades.leerContexto(identidad),
      pasoModelo: (peticion) => actividades.pasoModelo(peticion),
      pasoHerramienta: (peticion) => actividades.pasoHerramienta(peticion),
      pedirAprobacion: (peticion) => actividades.pedirAprobacion(peticion),
      esperarDecision: (aprobacionId) =>
        Promise.resolve({ aprobacionId, sentido: 'rechazada', personaId: null }),
      anotarPaso: (peticion) => actividades.anotarPaso(peticion),
      senalDeAprendizaje: (peticion) => actividades.senalDeAprendizaje(peticion),
    };

    const resultado = await ejecutarBucle(operaciones, {
      ...identidad,
      encargo: 'Revisa las facturas vencidas.',
    });

    expect(resultado.estado).toBe('completada');
    expect(bedrock.peticiones).toHaveLength(2);
    const segunda = (
      bedrock.peticiones[1]?.cuerpo as {
        messages: {
          role: string;
          content: { type: string; id?: string; tool_use_id?: string }[] | string;
        }[];
      }
    ).messages;
    expect(segunda.map((mensaje) => mensaje.role)).toEqual(['user', 'assistant', 'user']);
    const turnoDelAsistente = segunda[1]?.content as { type: string; id?: string }[];
    const turnoDeResultados = segunda[2]?.content as { type: string; tool_use_id?: string }[];
    expect(turnoDelAsistente.map((bloque) => bloque.type)).toEqual(['text', 'tool_use']);
    expect(turnoDeResultados[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: turnoDelAsistente[1]?.id,
    });
    expect((await usos(montaje)).map((uso) => uso.modelo)).toEqual([
      'claude-sonnet-4-6',
      'claude-sonnet-4-6',
    ]);
  });

  it('la siembra de Bitclick da de alta las tarifas de Anthropic que faltan y no repite las que ya están', async () => {
    const bedrock = await servidor(respuestaDeTexto('Nada que reclamar.'));
    const montaje = await montar(bedrock, { conTarifas: false });
    const { tenantId } = montaje.semilla;

    const primera = await cargarTarifasDeBitclick(montaje.cliente, tenantId);
    const segunda = await cargarTarifasDeBitclick(montaje.cliente, tenantId);

    expect(primera).toBeGreaterThan(0);
    expect(segunda).toBe(0);
    // Con sus tarifas, el puesto ya puede dar un paso real.
    await expect(montaje.actividades.pasoModelo(peticion(montaje))).resolves.toMatchObject({
      texto: 'Nada que reclamar.',
    });
  });

  it('un puesto con enrutado vacío falla en voz alta en vez de caer a prueba', async () => {
    const bedrock = await servidor(respuestaDeTexto('no debería llamarse'));
    const montaje = await montar(bedrock, { papel: {} });

    await expect(montaje.actividades.pasoModelo(peticion(montaje))).rejects.toThrow(
      /enrutado del puesto no es válido/,
    );
    expect(bedrock.peticiones).toHaveLength(0);
  });
});

describe('contexto de actividades sin enrutador explícito', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('no cae al proveedor de prueba: sin credenciales del proveedor elegido, no se construye', () => {
    for (const clave of [
      'AIW_PROVEEDOR_MODELOS',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_PROFILE',
    ]) {
      vi.stubEnv(clave, '');
    }
    vi.stubEnv('AIW_BEDROCK_REGION_UE', 'eu-north-1');
    expect(() =>
      crearContextoDeActividades({ urlBaseDeDatos: 'postgresql://x@127.0.0.1/x' }),
    ).toThrow(/AWS_ACCESS_KEY_ID/);
  });

  it('con prueba elegido por escrito, se construye sin credenciales', async () => {
    vi.stubEnv('AIW_PROVEEDOR_MODELOS', 'prueba');
    const contexto = crearContextoDeActividades({ urlBaseDeDatos: 'postgresql://x@127.0.0.1/x' });
    expect(contexto.enrutador.eleccion).toEqual({ principal: 'prueba' });
    await contexto.cerrar();
  });
});
