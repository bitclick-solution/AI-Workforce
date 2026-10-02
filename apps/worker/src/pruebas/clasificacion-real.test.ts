/**
 * El paso de clasificación de la sala con un proveedor real, contra la base y un
 * servidor que imita la API de Mensajes de Bedrock (ni credenciales ni llamadas reales).
 *
 * Comprueba lo que la decisión 7 de la especificación promete: el coste sale de la
 * tarifa vigente del tenant, una llamada sin tarifa no se hace, la salida lleva la
 * enumeración cerrada de identificadores, y un fallo del proveedor no cae en el
 * respaldo de otro: se propaga y la sala sigue con el silencio.
 */
import { readFileSync } from 'node:fs';

import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS } from '@aiw/db/pruebas';
import { RUTA_CATALOGO_EJEMPLO, registrarTarifa, tarifasDelCatalogo } from '@aiw/ledger';
import { clienteSimulado, enrutadorDesdeEntorno } from '@aiw/models';
import {
  iniciarServidorSimulado,
  respuestaDeErrorHttp,
  respuestaDeTexto,
  type ServidorSimulado,
} from '@aiw/models/pruebas';
import { moderarConModelo } from '@aiw/rooms';
import { afterEach, describe, expect, it } from 'vitest';

import { crearClasificadorDeSala } from '../actividades/clasificacion.js';
import { montarParaPruebas, type MontajeDePruebas } from './montaje.js';

const SALA = [
  { puestoId: 'p-cobros', nombre: 'Cobros', estado: 'activo', temas: ['cobro'] },
];
const MENSAJE = 'quién nos debe dinero desde hace más de dos meses';

describe.skipIf(!HAY_BASE_DE_DATOS)('clasificación de la sala · proveedor real', () => {
  const servidores: ServidorSimulado[] = [];
  const montajes: MontajeDePruebas[] = [];

  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((m) => m.cerrar()));
    await Promise.all(servidores.splice(0).map((s) => s.cerrar()));
  });

  async function montar(respuestas: unknown | unknown[], conTarifas = true) {
    const bedrock = await iniciarServidorSimulado(respuestas);
    servidores.push(bedrock);
    const vertex = await iniciarServidorSimulado(respuestaDeTexto('{"respaldo":true}'));
    servidores.push(vertex);
    const enrutador = enrutadorDesdeEntorno(
      { AIW_PROVEEDOR_MODELOS: 'bedrock-ue', AIW_PROVEEDOR_MODELOS_RESPALDO: 'vertex-ue' },
      {
        clientes: {
          'bedrock-ue': clienteSimulado(bedrock.url),
          'vertex-ue': clienteSimulado(vertex.url),
        },
      },
    );
    const montaje = await montarParaPruebas({ nombre: 'Clasificación real', enrutador });
    montajes.push(montaje);
    const { tenantId } = montaje.semilla;
    if (conTarifas) {
      const catalogo: unknown = JSON.parse(readFileSync(RUTA_CATALOGO_EJEMPLO, 'utf8'));
      for (const tarifa of tarifasDelCatalogo(catalogo).filter((t) => t.proveedor === 'anthropic')) {
        await conTenant(montaje.cliente, tenantId, (tx) => registrarTarifa(tx, tenantId, tarifa));
      }
    }
    return { montaje, bedrock, vertex };
  }

  function clasificador(montaje: MontajeDePruebas) {
    return crearClasificadorDeSala(montaje.contexto, {
      tenantId: montaje.semilla.tenantId,
      mensajeId: 'mensaje-1',
      papel: 'haiku45',
      clasePaso: 'moderador_sala',
      modeloDePrueba: 'deterministico-moderador',
    });
  }

  it('cobra la llamada con la tarifa vigente y manda la enumeración cerrada de puestos', async () => {
    const { montaje, bedrock } = await montar(
      respuestaDeTexto(
        JSON.stringify({ puestoIds: ['p-cobros'], pideOperacion: false, motivo: 'Impagados.' }),
      ),
    );
    const { decision, pasoDeModelo } = await moderarConModelo(MENSAJE, SALA, {
      ambito: 'departamento',
      clasificador: clasificador(montaje),
    });
    expect(decision.tipo).toBe('intervenir');
    expect(pasoDeModelo.usado && pasoDeModelo.costeEuros).toBeGreaterThan(0);

    const cuerpo = JSON.stringify(bedrock.peticiones[0]?.cuerpo);
    expect(cuerpo).toContain('p-cobros');
    expect(cuerpo).toMatch(/enum/);
    // Ni prompt ni petición llevan credenciales.
    expect(cuerpo).not.toMatch(/AWS_|secret|password/i);
  });

  it('una salida con un puesto inventado no es una intervención, también con el proveedor real', async () => {
    const { montaje } = await montar(
      respuestaDeTexto(
        JSON.stringify({ puestoIds: ['p-inventado'], pideOperacion: false, motivo: 'Eso.' }),
      ),
    );
    const { decision, pasoDeModelo } = await moderarConModelo(MENSAJE, SALA, {
      ambito: 'departamento',
      clasificador: clasificador(montaje),
    });
    expect(decision.tipo).toBe('silencio');
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'no_disponible' });
    // Límite conocido: el adaptador de Anthropic lanza ante una salida fuera de esquema
    // antes de devolver los tokens, así que esa llamada no queda anotada. El proveedor
    // ya restringe la salida con el esquema estricto; esto es la defensa de después.
  });

  it('sin tarifa vigente no se llama: una llamada que no se puede cobrar no se hace', async () => {
    const { montaje, bedrock } = await montar(respuestaDeTexto('{}'), false);
    const { decision, pasoDeModelo } = await moderarConModelo(MENSAJE, SALA, {
      ambito: 'departamento',
      clasificador: clasificador(montaje),
    });
    expect(decision.tipo).toBe('silencio');
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'no_disponible', costeEuros: 0 });
    expect(bedrock.peticiones).toHaveLength(0);
  });

  it('un fallo del proveedor no cae en el respaldo de otro: la sala sigue con el silencio', async () => {
    const { montaje, vertex } = await montar(respuestaDeErrorHttp(403, 'caído'));
    const { decision } = await moderarConModelo(MENSAJE, SALA, {
      ambito: 'departamento',
      clasificador: clasificador(montaje),
    });
    expect(decision.tipo).toBe('silencio');
    expect(decision.motivo).toContain('no estuvo disponible');
    expect(vertex.peticiones).toHaveLength(0);
  });
});
