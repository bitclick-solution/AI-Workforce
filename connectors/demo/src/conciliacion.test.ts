/**
 * El contrato de conciliación bancaria, comprobado por el protocolo.
 *
 * Es la referencia que comparten este conector y `connectors/odoo`: mismos
 * nombres, mismos esquemas, mismo orden, misma idempotencia y los mismos cuatro
 * motivos de error. Con el fallo inyectable, la CI prueba los reintentos.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import {
  APUNTES_DEMO,
  Apunte,
  SalidaLeerExtractoBancario,
  SalidaProponerAsientoDiferencia,
} from './conciliacion.js';
import { motivoDelError } from './errores.js';
import {
  HERRAMIENTA_ASIENTO,
  HERRAMIENTA_EXTRACTO,
  crearServidorDemo,
  type OpcionesServidorDemo,
} from './servidor.js';

async function conectar(opciones: Partial<OpcionesServidorDemo> = {}) {
  const demo = crearServidorDemo({
    credencial: 'credencial-de-prueba-generada',
    credencialEsperada: 'credencial-de-prueba-generada',
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

async function leer(cliente: Client, argumentos: Record<string, unknown> = {}) {
  const resultado = await cliente.callTool({ name: HERRAMIENTA_EXTRACTO, arguments: argumentos });
  return SalidaLeerExtractoBancario.parse(JSON.parse(textoDe(resultado)));
}

const ASIENTO = {
  apunte_id: 'apt-0002',
  documento_id: 'inv-0003',
  importe_diferencia: -10,
  cuenta_contrapartida: '629000',
  motivo: 'Comisión bancaria descontada del cobro.',
};

async function proponer(cliente: Client, argumentos: Record<string, unknown>) {
  return cliente.callTool({ name: HERRAMIENTA_ASIENTO, arguments: argumentos });
}

function motivoDe(resultado: Record<string, unknown>) {
  expect(resultado['isError']).toBe(true);
  return motivoDelError(textoDe(resultado));
}

describe('catálogo de conciliación', () => {
  it('anuncia el extracto como lectura y el asiento como escritura', async () => {
    const { cliente } = await conectar();
    const { tools } = await cliente.listTools();
    expect(tools.map((herramienta) => herramienta.name)).toEqual([
      'listar_facturas_vencidas',
      'crear_nota_seguimiento',
      HERRAMIENTA_EXTRACTO,
      HERRAMIENTA_ASIENTO,
    ]);
    const extracto = tools.find((herramienta) => herramienta.name === HERRAMIENTA_EXTRACTO);
    const asiento = tools.find((herramienta) => herramienta.name === HERRAMIENTA_ASIENTO);
    expect(extracto?.annotations?.readOnlyHint).toBe(true);
    expect(asiento?.annotations?.readOnlyHint).toBe(false);
    expect(Object.keys(asiento?.inputSchema.properties ?? {}).sort()).toEqual(
      [
        'apunte_id',
        'clave_idempotencia',
        'cuenta_contrapartida',
        'documento_id',
        'importe_diferencia',
        'motivo',
      ].sort(),
    );
  });
});

describe('contrato · leer_extracto_bancario', () => {
  it('por defecto devuelve solo los sin casar, del más antiguo al más reciente', async () => {
    const { cliente } = await conectar();
    const salida = await leer(cliente);
    expect(salida.apuntes.map((apunte) => apunte.id)).toEqual(['apt-0002', 'apt-0003', 'apt-0005']);
    expect(salida.apuntes.every((apunte) => !apunte.casado && apunte.documento_id === null)).toBe(
      true,
    );
    expect(salida.total).toBe(salida.apuntes.length);
  });

  it('con solo_sin_casar en false devuelve también los casados, con su documento', async () => {
    const { cliente } = await conectar();
    const salida = await leer(cliente, { solo_sin_casar: false });
    expect(salida.total).toBe(APUNTES_DEMO.length);
    const fechas = salida.apuntes.map((apunte) => apunte.fecha);
    expect(fechas).toEqual([...fechas].sort());
    expect(salida.apuntes.filter((apunte) => apunte.casado).map((a) => a.documento_id)).toEqual([
      'inv-0002',
      'inv-0001',
    ]);
  });

  it('filtra por cuenta y por fechas, y respeta el límite', async () => {
    const { cliente } = await conectar();
    expect((await leer(cliente, { cuenta_id: 'cta-002' })).apuntes.map((a) => a.id)).toEqual([
      'apt-0005',
    ]);
    expect(
      (await leer(cliente, { desde: '2026-09-13', hasta: '2026-09-16' })).apuntes.map((a) => a.id),
    ).toEqual(['apt-0003']);
    expect((await leer(cliente, { limite: 1 })).apuntes.map((a) => a.id)).toEqual(['apt-0002']);
  });

  it('cada apunte cumple el esquema del contrato, con importe con signo', async () => {
    const { cliente } = await conectar();
    const salida = await leer(cliente, { solo_sin_casar: false });
    for (const apunte of salida.apuntes) expect(Apunte.safeParse(apunte).success).toBe(true);
    expect(salida.apuntes.some((apunte) => apunte.importe < 0)).toBe(true);
  });

  it.each([
    ['límite fuera de rango', { limite: 500 }],
    ['límite cero', { limite: 0 }],
    ['hasta anterior a desde', { desde: '2026-09-30', hasta: '2026-09-01' }],
    ['fecha que no existe', { desde: '2026-02-30' }],
  ])('%s devuelve invalido, no un error del protocolo', async (_caso, argumentos) => {
    const { cliente } = await conectar();
    const resultado = await cliente.callTool({ name: HERRAMIENTA_EXTRACTO, arguments: argumentos });
    expect(motivoDe(resultado)).toBe('invalido');
  });
});

describe('contrato · proponer_asiento_diferencia', () => {
  it('guarda un borrador y devuelve estado «borrador»', async () => {
    const { cliente, demo } = await conectar();
    const resultado = await proponer(cliente, ASIENTO);
    const salida = SalidaProponerAsientoDiferencia.parse(JSON.parse(textoDe(resultado)));
    expect(salida).toMatchObject({ id: 'asi-0001', apunte_id: 'apt-0002', estado: 'borrador' });
    expect(demo.asientos).toHaveLength(1);
    expect(demo.asientos.every((asiento) => asiento.estado === 'borrador')).toBe(true);
  });

  it('no ofrece ninguna herramienta que contabilice, anule o modifique asientos', async () => {
    const { cliente } = await conectar();
    const { tools } = await cliente.listTools();
    expect(tools.map((herramienta) => herramienta.name).join(' ')).not.toMatch(
      /contabiliz|publicar|anular|confirmar|modificar/,
    );
  });

  it('con la misma clave devuelve el mismo borrador y no crea otro', async () => {
    const { cliente, demo } = await conectar();
    const entrada = { ...ASIENTO, clave_idempotencia: 'tarea-9-paso-2' };
    const primera = textoDe(await proponer(cliente, entrada));
    const segunda = textoDe(await proponer(cliente, entrada));
    expect(segunda).toBe(primera);
    expect(demo.asientos).toHaveLength(1);
  });

  it('con la misma clave y otros datos devuelve invalido', async () => {
    const { cliente, demo } = await conectar();
    const clave_idempotencia = 'tarea-9-paso-3';
    await proponer(cliente, { ...ASIENTO, clave_idempotencia });
    const resultado = await proponer(cliente, {
      ...ASIENTO,
      importe_diferencia: -11,
      clave_idempotencia,
    });
    expect(motivoDe(resultado)).toBe('invalido');
    expect(demo.asientos).toHaveLength(1);
  });

  it('claves distintas crean borradores distintos', async () => {
    const { cliente, demo } = await conectar();
    await proponer(cliente, { ...ASIENTO, clave_idempotencia: 'a' });
    await proponer(cliente, { ...ASIENTO, clave_idempotencia: 'b' });
    expect(demo.asientos.map((asiento) => asiento.id)).toEqual(['asi-0001', 'asi-0002']);
  });

  it.each([
    ['sin documento', { documento_id: undefined }],
    ['sin cuenta de contrapartida', { cuenta_contrapartida: undefined }],
    ['con diferencia cero', { importe_diferencia: 0 }],
    ['con tres decimales', { importe_diferencia: 1.005 }],
    ['con motivo vacío', { motivo: '' }],
    ['con motivo de más de 500 caracteres', { motivo: 'a'.repeat(501) }],
    ['con HTML en el motivo', { motivo: 'Aviso <b>urgente</b>' }],
  ])('%s devuelve invalido y no guarda nada', async (_caso, cambio) => {
    const { cliente, demo } = await conectar();
    const resultado = await proponer(cliente, { ...ASIENTO, ...cambio });
    expect(motivoDe(resultado)).toBe('invalido');
    expect(demo.asientos).toHaveLength(0);
  });

  it.each([
    ['apunte', { apunte_id: 'apt-9999' }],
    ['documento', { documento_id: 'inv-9999' }],
    ['cuenta de contrapartida', { cuenta_contrapartida: '000000' }],
  ])('un %s que no existe devuelve no_encontrada y no guarda nada', async (_caso, cambio) => {
    const { cliente, demo } = await conectar();
    const resultado = await proponer(cliente, { ...ASIENTO, ...cambio });
    expect(motivoDe(resultado)).toBe('no_encontrada');
    expect(demo.asientos).toHaveLength(0);
  });
});

describe('contrato · fallo inyectable y credencial', () => {
  it('temporal en el fallo inyectado, en las dos herramientas, y después responde', async () => {
    const { cliente, demo } = await conectar({ fallosIniciales: 2 });
    const primero = await cliente.callTool({ name: HERRAMIENTA_EXTRACTO, arguments: {} });
    expect(motivoDe(primero)).toBe('temporal');
    const segundo = await proponer(cliente, ASIENTO);
    expect(motivoDe(segundo)).toBe('temporal');
    expect(demo.asientos).toHaveLength(0);
    expect((await leer(cliente)).total).toBe(3);
    expect(
      SalidaProponerAsientoDiferencia.safeParse(
        JSON.parse(textoDe(await proponer(cliente, ASIENTO))),
      ).success,
    ).toBe(true);
    expect(demo.llamadas.get(HERRAMIENTA_ASIENTO)).toBe(2);
  });

  it('no_autorizado cuando se revoca la credencial, y no guarda nada', async () => {
    const { cliente, demo } = await conectar();
    demo.revocarCredencial();
    const lectura = await cliente.callTool({ name: HERRAMIENTA_EXTRACTO, arguments: {} });
    expect(motivoDe(lectura)).toBe('no_autorizado');
    expect(motivoDe(await proponer(cliente, ASIENTO))).toBe('no_autorizado');
    expect(demo.asientos).toHaveLength(0);
  });
});

describe('extracto de prueba', () => {
  it('tres sin casar y dos casados, sin ningún dato personal ni cuenta real', () => {
    expect(APUNTES_DEMO.filter((apunte) => !apunte.casado)).toHaveLength(3);
    expect(APUNTES_DEMO.filter((apunte) => apunte.casado)).toHaveLength(2);
    const crudo = JSON.stringify(APUNTES_DEMO);
    expect(crudo).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(crudo).not.toMatch(/\b[A-Z]{2}\d{2}[ ]?\d{4}/);
    expect(crudo).not.toMatch(/\b[0-9]{8}[A-Z]\b/);
  });
});
