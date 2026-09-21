/**
 * El contrato de las dos herramientas, comprobado por el protocolo.
 *
 * Estas pruebas son el contrato ejecutable que comparten este conector y el de
 * Odoo: nombres, esquemas de entrada, forma de la salida, orden de la lista,
 * idempotencia y los cuatro motivos de error. Si alguna falla, uno de los dos
 * conectores ha dejado de cumplir lo acordado.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { FACTURAS_DEMO, facturasVencidas, type FacturaVencida } from './datos.js';
import { CODIGOS_DEMO, motivoDelError } from './errores.js';
import {
  CredencialDemoNoValida,
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  LIMITES,
  crearServidorDemo,
  type OpcionesServidorDemo,
} from './servidor.js';

const CREDENCIAL = 'credencial-de-prueba-generada';

async function conectar(opciones: Partial<OpcionesServidorDemo> = {}) {
  const demo = crearServidorDemo({
    credencial: CREDENCIAL,
    credencialEsperada: CREDENCIAL,
    ...opciones,
  });
  const [delCliente, delServidor] = InMemoryTransport.createLinkedPair();
  const cliente = new Client({ name: 'prueba', version: '0.0.0' });
  await Promise.all([demo.servidor.connect(delServidor), cliente.connect(delCliente)]);
  return { demo, cliente };
}

function textoDe(resultado: Record<string, unknown>): string {
  const contenido = resultado['content'] as { type: string; text?: string }[] | undefined;
  return contenido?.map((parte) => parte.text ?? '').join('') ?? '';
}

function cargaDe<T>(resultado: Record<string, unknown>): T {
  return JSON.parse(textoDe(resultado)) as T;
}

interface Listado {
  facturas: FacturaVencida[];
  total: number;
}

interface NotaCreada {
  id: string;
  factura_id: string;
  tipo: 'nota' | 'actividad';
  creado_en: string;
}

describe('contrato · listar_facturas_vencidas', () => {
  it('se descubre como lectura y publica sus dos argumentos opcionales', async () => {
    const { cliente } = await conectar();
    const { tools } = await cliente.listTools();
    const herramienta = tools.find((candidata) => candidata.name === HERRAMIENTA_LISTAR);

    expect(herramienta?.annotations?.readOnlyHint).toBe(true);
    const esquema = herramienta?.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(esquema.properties ?? {}).sort()).toEqual(['dias_vencida_minimo', 'limite']);
    await cliente.close();
  });

  it('devuelve solo las vencidas, con total y los campos del contrato', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<Listado>(
      await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} }),
    );

    expect(carga.total).toBe(3);
    expect(carga.facturas).toHaveLength(3);
    expect(carga.facturas.length).toBeLessThan(FACTURAS_DEMO.length);
    expect(Object.keys(carga.facturas[0] ?? {}).sort()).toEqual([
      'cliente',
      'dias_vencida',
      'fecha_emision',
      'fecha_vencimiento',
      'id',
      'importe_pendiente',
      'moneda',
      'numero',
    ]);
    expect(carga.facturas[0]?.cliente.nombre).toContain('Talleres');
    expect(carga.facturas[0]?.moneda).toBe('EUR');
    expect(carga.facturas.every((factura) => factura.dias_vencida > 0)).toBe(true);
    await cliente.close();
  });

  it('las ordena de más a menos días vencida', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<Listado>(
      await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} }),
    );
    const dias = carga.facturas.map((factura) => factura.dias_vencida);

    expect(dias).toEqual([...dias].sort((una, otra) => otra - una));
    await cliente.close();
  });

  it('respeta el límite quedándose con las más vencidas', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<Listado>(
      await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: { limite: 2 } }),
    );

    expect(carga.total).toBe(2);
    expect(carga.facturas.map((factura) => factura.numero)).toEqual(['F-2026-0001', 'F-2026-0002']);
    await cliente.close();
  });

  it('respeta el mínimo de días vencida', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<Listado>(
      await cliente.callTool({
        name: HERRAMIENTA_LISTAR,
        arguments: { dias_vencida_minimo: 30 },
      }),
    );

    expect(carga.total).toBe(1);
    expect(carga.facturas[0]?.numero).toBe('F-2026-0001');
    await cliente.close();
  });

  it('un mínimo de cero no cuela facturas al día: al día no es vencida', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<Listado>(
      await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: { dias_vencida_minimo: 0 } }),
    );

    expect(carga.total).toBe(3);
    await cliente.close();
  });

  it('un límite fuera de rango devuelve invalido, no un error del protocolo', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_LISTAR,
      arguments: { limite: LIMITES.limiteMaximo + 1 },
    });

    expect(resultado.isError).toBe(true);
    expect(motivoDelError(textoDe(resultado))).toBe('invalido');
    await cliente.close();
  });

  it('un mínimo de días negativo devuelve invalido', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_LISTAR,
      arguments: { dias_vencida_minimo: -3 },
    });

    expect(motivoDelError(textoDe(resultado))).toBe('invalido');
    await cliente.close();
  });
});

describe('contrato · crear_nota_seguimiento', () => {
  it('se descubre como escritura y publica sus cinco argumentos', async () => {
    const { cliente } = await conectar();
    const { tools } = await cliente.listTools();
    const herramienta = tools.find((candidata) => candidata.name === HERRAMIENTA_NOTA);

    expect(herramienta?.annotations?.readOnlyHint).toBe(false);
    const esquema = herramienta?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(Object.keys(esquema.properties ?? {}).sort()).toEqual([
      'clave_idempotencia',
      'factura_id',
      'fecha_limite',
      'texto',
      'tipo',
    ]);
    expect(esquema.required?.sort()).toEqual(['factura_id', 'texto']);
    await cliente.close();
  });

  it('guarda la nota y devuelve identificador, factura, tipo y fecha', async () => {
    const { demo, cliente } = await conectar();
    const carga = cargaDe<NotaCreada>(
      await cliente.callTool({
        name: HERRAMIENTA_NOTA,
        arguments: { factura_id: 'inv-0001', texto: 'Te recordamos el pago pendiente.' },
      }),
    );

    expect(carga.factura_id).toBe('inv-0001');
    expect(carga.tipo).toBe('nota');
    expect(carga.id).toMatch(/^nota-\d{4}$/);
    expect(Date.parse(carga.creado_en)).not.toBeNaN();
    expect(demo.notas).toHaveLength(1);
    await cliente.close();
  });

  it('acepta el número de factura además del identificador', async () => {
    const { cliente } = await conectar();
    const carga = cargaDe<NotaCreada>(
      await cliente.callTool({
        name: HERRAMIENTA_NOTA,
        arguments: { factura_id: 'F-2026-0002', texto: 'Hola.' },
      }),
    );
    expect(carga.factura_id).toBe('inv-0002');
    await cliente.close();
  });

  it('crea una actividad con fecha límite', async () => {
    const { demo, cliente } = await conectar();
    const carga = cargaDe<NotaCreada>(
      await cliente.callTool({
        name: HERRAMIENTA_NOTA,
        arguments: {
          factura_id: 'inv-0001',
          texto: 'Llamar al cliente.',
          tipo: 'actividad',
          fecha_limite: '2026-09-25',
        },
      }),
    );

    expect(carga.tipo).toBe('actividad');
    expect(demo.notas[0]?.fecha_limite).toBe('2026-09-25');
    await cliente.close();
  });

  it('con la misma clave de idempotencia devuelve la misma nota y no crea otra', async () => {
    const { demo, cliente } = await conectar();
    const argumentos = {
      factura_id: 'inv-0001',
      texto: 'Primera redacción.',
      clave_idempotencia: 'tarea-7:paso-4',
    };
    const primera = cargaDe<NotaCreada>(
      await cliente.callTool({ name: HERRAMIENTA_NOTA, arguments: argumentos }),
    );
    const segunda = cargaDe<NotaCreada>(
      await cliente.callTool({
        name: HERRAMIENTA_NOTA,
        // Texto distinto a propósito: con la misma clave manda la primera llamada.
        arguments: { ...argumentos, texto: 'Otra redacción.' },
      }),
    );

    expect(segunda.id).toBe(primera.id);
    expect(demo.notas).toHaveLength(1);
    expect(demo.notas[0]?.texto).toBe('Primera redacción.');
    await cliente.close();
  });

  it('claves distintas crean notas distintas', async () => {
    const { demo, cliente } = await conectar();
    for (const clave of ['a', 'b']) {
      await cliente.callTool({
        name: HERRAMIENTA_NOTA,
        arguments: { factura_id: 'inv-0001', texto: `Nota ${clave}.`, clave_idempotencia: clave },
      });
    }
    expect(demo.notas).toHaveLength(2);
    await cliente.close();
  });
});

describe('contrato · errores con code, message y datos.motivo', () => {
  it('no_encontrada cuando la factura no existe, y no guarda nada', async () => {
    const { demo, cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura_id: 'inv-9999', texto: 'Nota imposible.' },
    });

    expect(resultado.isError).toBe(true);
    const cuerpo = cargaDe<{ code: string; message: string; datos: { motivo: string } }>(resultado);
    expect(cuerpo.code).toBe(CODIGOS_DEMO.no_encontrada);
    expect(cuerpo.datos.motivo).toBe('no_encontrada');
    expect(cuerpo.message).toContain('No existe la factura');
    expect(demo.notas).toHaveLength(0);
    await cliente.close();
  });

  it('invalido cuando una nota trae fecha límite', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura_id: 'inv-0001', texto: 'Nota.', fecha_limite: '2026-09-25' },
    });

    expect(motivoDelError(textoDe(resultado))).toBe('invalido');
    await cliente.close();
  });

  it('invalido cuando el texto pasa de los 2000 caracteres', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura_id: 'inv-0001', texto: 'a'.repeat(LIMITES.textoMaximo + 1) },
    });

    expect(motivoDelError(textoDe(resultado))).toBe('invalido');
    await cliente.close();
  });

  it('invalido cuando el texto trae HTML', async () => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura_id: 'inv-0001', texto: 'Hola <b>cliente</b>.' },
    });

    expect(motivoDelError(textoDe(resultado))).toBe('invalido');
    await cliente.close();
  });

  it('temporal en el fallo inyectado, y a la tercera responde', async () => {
    const { demo, cliente } = await conectar({ fallosIniciales: 2 });

    const primera = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const segunda = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const tercera = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });

    expect(motivoDelError(textoDe(primera))).toBe('temporal');
    expect(motivoDelError(textoDe(segunda))).toBe('temporal');
    expect(tercera.isError).toBeFalsy();
    expect(textoDe(tercera)).toContain('F-2026-0001');
    expect(demo.llamadas.get(HERRAMIENTA_LISTAR)).toBe(3);
    await cliente.close();
  });

  it('no_autorizado cuando la credencial se revoca con la conexión abierta, y no guarda nada', async () => {
    const { demo, cliente } = await conectar();
    const antes = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    expect(antes.isError).toBeFalsy();

    // Es lo que pasa cuando alguien invalida la clave de API en el sistema de
    // gestión con el conector ya conectado: la conexión sigue viva y cada llamada
    // vuelve con `no_autorizado`, que la plataforma no reintenta.
    demo.revocarCredencial();

    const lista = await cliente.callTool({ name: HERRAMIENTA_LISTAR, arguments: {} });
    const nota = await cliente.callTool({
      name: HERRAMIENTA_NOTA,
      arguments: { factura_id: 'inv-0001', texto: 'Llamada de seguimiento.' },
    });
    for (const resultado of [lista, nota]) {
      expect(resultado.isError).toBe(true);
      const cuerpo = cargaDe<{ code: string; message: string; datos: { motivo: string } }>(
        resultado,
      );
      expect(cuerpo.code).toBe(CODIGOS_DEMO.no_autorizado);
      expect(cuerpo.datos.motivo).toBe('no_autorizado');
      expect(motivoDelError(textoDe(resultado))).toBe('no_autorizado');
    }
    expect(demo.notas).toHaveLength(0);
    expect(demo.llamadas.get(HERRAMIENTA_LISTAR)).toBe(2);
    await cliente.close();
  });

  it('un motivo que no es del contrato no se interpreta', () => {
    expect(motivoDelError('vaya, se ha roto')).toBeUndefined();
    expect(motivoDelError(JSON.stringify({ datos: { motivo: 'vete_a_saber' } }))).toBeUndefined();
  });
});

describe('credencial del conector', () => {
  it('rechaza construirse con una credencial que no cuadra, sin decir cuál era', () => {
    let capturado: unknown;
    try {
      crearServidorDemo({ credencial: 'otra', credencialEsperada: CREDENCIAL });
    } catch (error) {
      capturado = error;
    }
    expect(capturado).toBeInstanceOf(CredencialDemoNoValida);
    expect(String(capturado)).not.toContain(CREDENCIAL);
    expect(String(capturado)).not.toContain('otra');
  });
});

describe('cartera de prueba', () => {
  it('tres vencidas y dos al día: el caso negativo del eval existe', () => {
    expect(facturasVencidas()).toHaveLength(3);
    expect(FACTURAS_DEMO).toHaveLength(5);
  });
});
