/**
 * Las dos herramientas de conciliación sobre respuestas grabadas: caminos de
 * éxito, de error y de idempotencia. Sin red y sin Odoo.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clienteGrabado, type ClienteMcpDinamico } from './cliente.js';
import { crearHerramientasConciliacion, type HerramientasConciliacion } from './conciliacion.js';
import type { ErrorConector } from './errores.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';

let herramientas: HerramientasConciliacion;
let cliente: ReturnType<typeof clienteGrabado>;

beforeEach(() => {
  cliente = clienteGrabado(cargarGrabaciones());
  herramientas = crearHerramientasConciliacion({ cliente, ahora: () => DIA_DE_LA_GRABACION });
});

const ASIENTO = {
  apunte_id: '301',
  documento_id: '46',
  importe_diferencia: -12,
  cuenta_contrapartida: '629000',
  motivo: 'Comisión bancaria descontada del cobro.',
};

describe('leer_extracto_bancario', () => {
  it('devuelve del más antiguo al más reciente y el total cuadra', async () => {
    const salida = await herramientas.leerExtractoBancario({});
    expect(salida.apuntes.map((apunte) => apunte.id)).toEqual(['301', '302', '303']);
    expect(salida.apuntes.map((apunte) => apunte.fecha)).toEqual([
      '2026-09-14',
      '2026-09-16',
      '2026-09-18',
    ]);
    expect(salida.total).toBe(salida.apuntes.length);
  });

  it('mapea importe con signo, moneda, cuenta y documento nulo si no está casado', async () => {
    const salida = await herramientas.leerExtractoBancario({});
    expect(salida.apuntes[0]).toEqual({
      id: '301',
      cuenta_id: '7',
      fecha: '2026-09-14',
      concepto: 'TRANSF. DISTRIBUCIONES DE MUESTRA SL F-2026-0430',
      importe: 975.5,
      moneda: 'EUR',
      casado: false,
      documento_id: null,
    });
    expect(salida.apuntes[2]?.importe).toBe(-12);
  });

  it('por defecto pide solo los sin casar y no devuelve ninguno casado', async () => {
    const salida = await herramientas.leerExtractoBancario({});
    expect(salida.apuntes.every((apunte) => !apunte.casado)).toBe(true);
    expect(JSON.stringify(cliente.llamadas[0]?.argumentos['domain'])).toContain('is_reconciled');
  });

  it('con solo_sin_casar en false devuelve también los casados, con su documento', async () => {
    const salida = await herramientas.leerExtractoBancario({ solo_sin_casar: false });
    const casado = salida.apuntes.find((apunte) => apunte.casado);
    expect(casado).toMatchObject({ id: '300', documento_id: '8800' });
    expect(salida.apuntes[0]?.id).toBe('300');
  });

  it('descarta un casado aunque el ERP ignore el filtro', async () => {
    const ignora: ClienteMcpDinamico = {
      cerrar: async () => undefined,
      llamar: async () =>
        (await clienteGrabado(cargarGrabaciones()).llamar('search_records', {
          model: 'account.bank.statement.line',
          domain: [],
        })) as unknown,
    };
    const solo = crearHerramientasConciliacion({ cliente: ignora });
    const salida = await solo.leerExtractoBancario({});
    expect(salida.apuntes.some((apunte) => apunte.casado)).toBe(false);
    expect(salida.total).toBe(3);
  });

  it('traduce cuenta, fechas y límite al dominio de Odoo', async () => {
    await herramientas.leerExtractoBancario({
      cuenta_id: '7',
      desde: '2026-09-01',
      hasta: '2026-09-30',
      limite: 2,
    });
    const llamada = cliente.llamadas[0];
    expect(llamada?.herramienta).toBe('search_records');
    expect(llamada?.argumentos['model']).toBe('account.bank.statement.line');
    expect(llamada?.argumentos['domain']).toEqual([
      ['journal_id', '=', 7],
      ['date', '>=', '2026-09-01'],
      ['date', '<=', '2026-09-30'],
      ['is_reconciled', '=', false],
    ]);
    expect(llamada?.argumentos['limit']).toBe(2);
    expect(llamada?.argumentos['fields']).toEqual([
      'journal_id',
      'date',
      'payment_ref',
      'amount',
      'currency_id',
      'is_reconciled',
      'move_id',
    ]);
  });

  it('recorta al límite pedido conservando los más antiguos', async () => {
    const salida = await herramientas.leerExtractoBancario({ limite: 2 });
    expect(salida.apuntes.map((apunte) => apunte.id)).toEqual(['301', '302']);
    expect(salida.total).toBe(2);
  });

  it.each([
    ['límite fuera de rango', { limite: 500 }],
    ['hasta anterior a desde', { desde: '2026-09-30', hasta: '2026-09-01' }],
    ['fecha inexistente', { desde: '2026-02-30' }],
    ['cuenta que no es un identificador de Odoo', { cuenta_id: 'banco-1' }],
  ])('rechaza %s sin llegar al ERP', async (_caso, entrada) => {
    await expect(herramientas.leerExtractoBancario(entrada)).rejects.toMatchObject({
      motivo: 'invalido',
    });
    expect(cliente.llamadas).toHaveLength(0);
  });

  it('un registro que no encaja sale invalido y no un dato a medias', async () => {
    const roto = clienteGrabado({
      search_records: [{ carga: { result: { success: true, result: [{ id: 1, amount: 'x' }] } } }],
    });
    const solo = crearHerramientasConciliacion({ cliente: roto });
    await expect(solo.leerExtractoBancario({})).rejects.toMatchObject({ motivo: 'invalido' });
  });

  it('un fallo pasajero del ERP sale temporal', async () => {
    const caido = clienteGrabado({ search_records: [{ error: 'Read timed out after 60s' }] });
    const solo = crearHerramientasConciliacion({ cliente: caido });
    await expect(solo.leerExtractoBancario({})).rejects.toMatchObject({
      motivo: 'temporal',
      reintentable: true,
    });
  });

  it('un acceso denegado sale no_autorizado y no es reintentable', async () => {
    const denegado = clienteGrabado({
      search_records: [{ error: 'Access denied for model account.bank.statement.line' }],
    });
    const solo = crearHerramientasConciliacion({ cliente: denegado });
    await expect(solo.leerExtractoBancario({})).rejects.toMatchObject({
      motivo: 'no_autorizado',
      reintentable: false,
    });
  });

  it('el detalle del ERP llega recortado, sin traza ni SQL', async () => {
    const conTraza = clienteGrabado({
      search_records: [
        {
          error: [
            'AccessError: no puedes leer extractos',
            'Traceback (most recent call last):',
            'SELECT id FROM account_bank_statement_line WHERE company_id = 1',
          ].join('\n'),
        },
      ],
    });
    try {
      await crearHerramientasConciliacion({ cliente: conTraza }).leerExtractoBancario({});
      expect.unreachable('la llamada debía fallar');
    } catch (error) {
      const mensaje = (error as ErrorConector).message;
      expect(mensaje).toContain('AccessError');
      expect(mensaje).not.toContain('Traceback');
      expect(mensaje).not.toContain('SELECT');
      expect(mensaje.length).toBeLessThan(400);
    }
  });
});

describe('proponer_asiento_diferencia', () => {
  it('crea solo un borrador por preparar, validar y ejecutar', async () => {
    const salida = await herramientas.proponerAsientoDiferencia(ASIENTO);
    expect(salida).toEqual({
      id: '7001',
      apunte_id: '301',
      estado: 'borrador',
      creado_en: DIA_DE_LA_GRABACION.toISOString(),
    });
    expect(cliente.llamadas.map((llamada) => llamada.herramienta)).toEqual([
      'search_records',
      'search_records',
      'search_records',
      'search_records',
      'preview_write',
      'validate_write',
      'execute_approved_write',
    ]);
  });

  it('el asiento cuadra: una comisión es haber en el banco y debe en la contrapartida', async () => {
    await herramientas.proponerAsientoDiferencia(ASIENTO);
    const escritura = cliente.llamadas.find((llamada) => llamada.herramienta === 'preview_write');
    expect(escritura?.argumentos).toMatchObject({ model: 'account.move', operation: 'create' });
    const valores = escritura?.argumentos['values'] as {
      move_type: string;
      line_ids: [number, number, { account_id: number; debit: number; credit: number }][];
    };
    expect(valores.move_type).toBe('entry');
    expect(valores.line_ids.map((linea) => linea[2])).toEqual([
      expect.objectContaining({ account_id: 572, debit: 0, credit: 12 }),
      expect.objectContaining({ account_id: 640, debit: 12, credit: 0 }),
    ]);
  });

  it('una diferencia positiva va al debe del banco', async () => {
    await herramientas.proponerAsientoDiferencia({ ...ASIENTO, importe_diferencia: 5.25 });
    const escritura = cliente.llamadas.find((llamada) => llamada.herramienta === 'preview_write');
    const valores = escritura?.argumentos['values'] as {
      line_ids: [number, number, { debit: number; credit: number }][];
    };
    expect(valores.line_ids[0]?.[2]).toMatchObject({ debit: 5.25, credit: 0 });
    expect(valores.line_ids[1]?.[2]).toMatchObject({ debit: 0, credit: 5.25 });
  });

  it('ninguna ruta contabiliza ni confirma el asiento', async () => {
    await herramientas.proponerAsientoDiferencia(ASIENTO);
    await herramientas.proponerAsientoDiferencia({ ...ASIENTO, motivo: 'Otro motivo.' });
    const permitidas = new Set([
      'search_records',
      'preview_write',
      'validate_write',
      'execute_approved_write',
    ]);
    for (const llamada of cliente.llamadas) {
      expect(permitidas.has(llamada.herramienta)).toBe(true);
      const texto = JSON.stringify(llamada.argumentos);
      expect(texto).not.toMatch(/action_post|button_post|"state"|"posted"/);
    }
    const ejecuciones = cliente.llamadas.filter(
      (llamada) => llamada.herramienta === 'execute_approved_write',
    );
    expect(ejecuciones.length).toBeGreaterThan(0);
    for (const ejecucion of ejecuciones) {
      expect(Object.keys(ejecucion.argumentos).sort()).toEqual(['approval', 'confirm']);
    }
  });

  it.each([
    ['sin documento', { documento_id: undefined }],
    ['sin cuenta de contrapartida', { cuenta_contrapartida: undefined }],
    ['con diferencia cero', { importe_diferencia: 0 }],
    ['con motivo con HTML', { motivo: '<script>x</script>' }],
    ['con un apunte que no es identificador de Odoo', { apunte_id: 'apt-1' }],
    ['con un código de cuenta con espacios', { cuenta_contrapartida: '629 000' }],
  ])('%s sale invalido sin llegar al ERP', async (_caso, cambio) => {
    await expect(
      herramientas.proponerAsientoDiferencia({ ...ASIENTO, ...cambio }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
    expect(cliente.llamadas).toHaveLength(0);
  });

  it.each([
    ['apunte', { apunte_id: '999999' }],
    ['documento', { documento_id: '999998' }],
    ['cuenta de contrapartida', { cuenta_contrapartida: '000000' }],
  ])('un %s que no existe sale no_encontrada y no escribe', async (_caso, cambio) => {
    await expect(
      herramientas.proponerAsientoDiferencia({ ...ASIENTO, ...cambio }),
    ).rejects.toMatchObject({ motivo: 'no_encontrada', reintentable: false });
    expect(cliente.llamadas.some((llamada) => llamada.herramienta === 'preview_write')).toBe(false);
  });

  it('con la misma clave devuelve el mismo borrador y no escribe dos veces', async () => {
    const entrada = { ...ASIENTO, clave_idempotencia: 'tarea-9-paso-2' };
    const primera = await herramientas.proponerAsientoDiferencia(entrada);
    const llamadasTrasLaPrimera = cliente.llamadas.length;
    const segunda = await herramientas.proponerAsientoDiferencia(entrada);
    expect(segunda).toEqual(primera);
    expect(cliente.llamadas).toHaveLength(llamadasTrasLaPrimera);
  });

  it('la misma clave con otros datos se rechaza', async () => {
    const clave_idempotencia = 'tarea-9-paso-3';
    await herramientas.proponerAsientoDiferencia({ ...ASIENTO, clave_idempotencia });
    const llamadas = cliente.llamadas.length;
    await expect(
      herramientas.proponerAsientoDiferencia({
        ...ASIENTO,
        importe_diferencia: -13,
        clave_idempotencia,
      }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
    expect(cliente.llamadas).toHaveLength(llamadas);
  });

  it('dos llamadas a la vez con la misma clave escriben un solo borrador', async () => {
    const entrada = { ...ASIENTO, clave_idempotencia: 'tarea-9-paso-4' };
    const [una, otra] = await Promise.all([
      herramientas.proponerAsientoDiferencia(entrada),
      herramientas.proponerAsientoDiferencia(entrada),
    ]);
    expect(otra).toEqual(una);
    expect(
      cliente.llamadas.filter((llamada) => llamada.herramienta === 'execute_approved_write'),
    ).toHaveLength(1);
  });

  it('una clave cuya escritura falló no deja nada guardado y se puede reintentar', async () => {
    const base = clienteGrabado(cargarGrabaciones());
    let falla = true;
    const intermitente: ClienteMcpDinamico = {
      cerrar: base.cerrar,
      llamar: async (herramienta, argumentos) => {
        if (herramienta === 'execute_approved_write' && falla) {
          falla = false;
          throw new Error('Read timed out after 60s talking to Odoo');
        }
        return base.llamar(herramienta, argumentos);
      },
    };
    const solo = crearHerramientasConciliacion({ cliente: intermitente });
    const entrada = { ...ASIENTO, clave_idempotencia: 'tarea-9-paso-5' };
    await expect(solo.proponerAsientoDiferencia(entrada)).rejects.toMatchObject({
      motivo: 'temporal',
    });
    const salida = await solo.proponerAsientoDiferencia(entrada);
    expect(salida.id).toBe('7001');
  });

  it('sin aprobación en la respuesta de validar, no ejecuta', async () => {
    const sinAprobacion = clienteGrabado({
      ...cargarGrabaciones(),
      validate_write: [{ carga: { result: { success: true, issues: [] } } }],
    });
    const solo = crearHerramientasConciliacion({ cliente: sinAprobacion });
    await expect(solo.proponerAsientoDiferencia(ASIENTO)).rejects.toMatchObject({
      motivo: 'invalido',
    });
    expect(
      sinAprobacion.llamadas.some((llamada) => llamada.herramienta === 'execute_approved_write'),
    ).toBe(false);
  });
});
