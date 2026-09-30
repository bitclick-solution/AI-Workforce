import { afterEach, describe, expect, it } from 'vitest';

import { clienteSimulado } from './adaptadores/clientes.js';
import { crearAdaptadorAnthropic } from './adaptadores/anthropic.js';
import { mensajesParaElPuerto } from './conversacion.js';
import { darPasoConPuerto } from './paso-puerto.js';
import {
  iniciarServidorSimulado,
  respuestaDeRechazo,
  respuestaDeTexto,
  respuestaDeUsoDeHerramienta,
  type ServidorSimulado,
} from './pruebas/index.js';
import { crearPuertoEnrutado } from './respaldo.js';
import { TrazasEnMemoria } from './trazas.js';

const HERRAMIENTA = {
  nombre: 'listar_facturas_vencidas',
  descripcion: 'Lee las facturas vencidas.',
  esquemaEntrada: {
    type: 'object',
    properties: { limite: { type: 'integer', minimum: 1, maximum: 50 } },
    required: ['limite'],
  },
};

describe('paso de modelo sobre el puerto real', () => {
  let servidor: ServidorSimulado | undefined;
  afterEach(async () => {
    await servidor?.cerrar();
    servidor = undefined;
  });

  async function pasoCon(respuestas: unknown | unknown[]) {
    servidor = await iniciarServidorSimulado(respuestas);
    const cliente = clienteSimulado(servidor.url);
    return crearPuertoEnrutado({
      papel: 'sonnet5',
      papelRespaldo: 'haiku45',
      principal: {
        proveedor: 'bedrock-ue',
        puerto: (papel) =>
          crearAdaptadorAnthropic(cliente, {
            papel,
            plataforma: 'bedrock-eu',
            configuracion: { esfuerzoPorClasePaso: {} },
          }),
      },
    });
  }

  it('devuelve las llamadas con su id, los tokens del contador y quién sirvió', async () => {
    const puerto = await pasoCon(
      respuestaDeUsoDeHerramienta('listar_facturas_vencidas', { limite: 5 }, { texto: 'Miro.' }),
    );
    const trazas = new TrazasEnMemoria();

    const paso = await darPasoConPuerto({
      puerto,
      clasePaso: 'negocio',
      sistema: 'Eres Cobros.',
      mensajes: [{ rol: 'user', contenido: 'Revisa las facturas.' }],
      herramientas: [HERRAMIENTA],
      atributos: { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' },
      trazas,
    });

    expect(paso.llamadas).toEqual([
      {
        id: 'toolu_simulado_01',
        herramienta: 'listar_facturas_vencidas',
        argumentos: { limite: 5 },
      },
    ]);
    expect(paso.motivoFin).toBe('tool-calls');
    expect(paso.tokens).toEqual({ entrada: 150, salida: 30, entradaCache: 0 });
    expect(paso.sirvio).toMatchObject({
      proveedor: 'bedrock-ue',
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
    });
    expect(paso.bloques).toHaveLength(2);
    expect(trazas.trazas[0]).toMatchObject({
      proveedor: 'bedrock-ue',
      modelo: 'eu.anthropic.claude-sonnet-4-6',
    });

    // El esquema del servidor MCP viaja estricto pero sin las restricciones que la API rechaza.
    const cuerpo = servidor?.peticiones[0]?.cuerpo as {
      tools: {
        strict: boolean;
        input_schema: { properties: { limite: Record<string, unknown> } };
      }[];
      system: { text: string; cache_control: unknown }[];
    };
    expect(cuerpo.tools[0]?.strict).toBe(true);
    expect(cuerpo.tools[0]?.input_schema.properties.limite).not.toHaveProperty('minimum');
    expect(cuerpo.system[0]).toMatchObject({
      text: 'Eres Cobros.',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('devuelve el texto de un turno sin herramientas como parada normal', async () => {
    const puerto = await pasoCon(respuestaDeTexto('Nada que reclamar.'));
    const paso = await darPasoConPuerto({
      puerto,
      clasePaso: 'negocio',
      sistema: 's',
      mensajes: [{ rol: 'user', contenido: 'hola' }],
      herramientas: [],
      atributos: { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' },
    });
    expect(paso).toMatchObject({ texto: 'Nada que reclamar.', motivoFin: 'stop', llamadas: [] });
  });

  it('un rechazo sin respaldo servido vuelve como rechazo con su categoría y sus tokens', async () => {
    const puerto = await pasoCon(respuestaDeRechazo('general_harms', 'no'));
    const paso = await darPasoConPuerto({
      puerto,
      clasePaso: 'negocio',
      sistema: 's',
      mensajes: [{ rol: 'user', contenido: 'hola' }],
      herramientas: [],
      atributos: { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' },
    });
    // Con `papelRespaldo: haiku45` el servidor simulado devuelve el mismo rechazo también al respaldo.
    expect(paso.rechazo).toEqual({ categoria: 'general_harms', explicacion: 'no' });
    expect(paso.intentosFallidos).toHaveLength(1);
    expect(paso.tokens.entrada).toBe(80);
  });

  it('la segunda vuelta devuelve al modelo su turno original (con razonamiento) y los resultados en un solo mensaje', async () => {
    const primera = respuestaDeUsoDeHerramienta('listar_facturas_vencidas', { limite: 5 }) as {
      content: unknown[];
    };
    primera.content.unshift({
      type: 'thinking',
      thinking: 'Miro las facturas.',
      signature: 'firma-opaca',
    });
    const puerto = await pasoCon([primera, respuestaDeTexto('Hecho.')]);

    const uno = await darPasoConPuerto({
      puerto,
      clasePaso: 'negocio',
      sistema: 's',
      mensajes: [{ rol: 'user', contenido: 'Revisa.' }],
      herramientas: [HERRAMIENTA],
      atributos: { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' },
    });

    const conversacion = [
      { papel: 'usuario' as const, texto: 'Revisa.' },
      {
        papel: 'agente' as const,
        texto: uno.texto,
        llamadas: uno.llamadas.map((l) => ({ ...l })),
        bloques: uno.bloques,
      },
      {
        papel: 'herramienta' as const,
        llamadaId: 'toolu_simulado_01',
        herramienta: 'listar_facturas_vencidas',
        texto: '3 facturas',
      },
    ];
    await darPasoConPuerto({
      puerto,
      clasePaso: 'negocio',
      sistema: 's',
      mensajes: mensajesParaElPuerto(conversacion),
      herramientas: [HERRAMIENTA],
      atributos: { tenantId: 't', puestoId: 'p', versionPuestoId: 'v', tareaId: 'x' },
    });

    const cuerpo = servidor?.peticiones[1]?.cuerpo as {
      messages: {
        role: string;
        content: { type: string; signature?: string; tool_use_id?: string }[];
      }[];
    };
    expect(cuerpo.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(cuerpo.messages[1]?.content.map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    expect(cuerpo.messages[1]?.content[0]?.signature).toBe('firma-opaca');
    expect(cuerpo.messages[2]?.content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_simulado_01',
    });
  });
});
