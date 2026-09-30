/**
 * Las dos herramientas sobre respuestas grabadas: caminos de éxito, de error y
 * de idempotencia. Sin red y sin Odoo, así que corren siempre y en la CI.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { clienteGrabado } from './cliente.js';
import { ErrorConector } from './errores.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas, fechaDeCorte, type Herramientas } from './herramientas.js';

function montar(): { herramientas: Herramientas; cliente: ReturnType<typeof clienteGrabado> } {
  const cliente = clienteGrabado(cargarGrabaciones());
  const herramientas = crearHerramientas({ cliente, ahora: () => DIA_DE_LA_GRABACION });
  return { herramientas, cliente };
}

let herramientas: Herramientas;
let cliente: ReturnType<typeof clienteGrabado>;

beforeEach(() => {
  ({ herramientas, cliente } = montar());
});

describe('listar_facturas_vencidas', () => {
  it('devuelve las vencidas de más a menos días y cuadra el total', async () => {
    const salida = await herramientas.listarFacturasVencidas({});
    expect(salida.facturas.map((factura) => factura.numero)).toEqual([
      'F-2026-0401',
      'F-2026-0412',
      'F-2026-0418',
    ]);
    expect(salida.facturas.map((factura) => factura.dias_vencida)).toEqual([60, 12, 3]);
    expect(salida.total).toBe(salida.facturas.length);
  });

  it('nunca devuelve una factura que no está vencida', async () => {
    const salida = await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 0 });
    expect(salida.facturas.every((factura) => factura.dias_vencida >= 1)).toBe(true);
    expect(salida.facturas.some((factura) => factura.numero === 'F-2026-0425')).toBe(false);
  });

  it('respeta el mínimo de días vencida', async () => {
    const salida = await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 10 });
    expect(salida.facturas.map((factura) => factura.numero)).toEqual([
      'F-2026-0401',
      'F-2026-0412',
    ]);
  });

  it('recorta al límite pedido conservando las más vencidas', async () => {
    const salida = await herramientas.listarFacturasVencidas({ limite: 1 });
    expect(salida.total).toBe(1);
    expect(salida.facturas[0]?.numero).toBe('F-2026-0401');
  });

  it('pide al ERP solo los campos del contrato y con la fecha de corte calculada', async () => {
    await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 5 });
    const llamada = cliente.llamadas[0];
    expect(llamada?.herramienta).toBe('search_records');
    expect(llamada?.argumentos['model']).toBe('account.move');
    expect(llamada?.argumentos['fields']).toEqual([
      'name',
      'partner_id',
      'amount_residual',
      'currency_id',
      'invoice_date',
      'invoice_date_due',
    ]);
    expect(JSON.stringify(llamada?.argumentos['domain'])).toContain(
      fechaDeCorte(DIA_DE_LA_GRABACION, 5),
    );
  });

  it.each([
    ['límite fuera de rango', { limite: 500 }],
    ['días vencida negativos', { dias_vencida_minimo: -3 }],
  ])('rechaza %s sin llegar al ERP', async (_caso, entrada) => {
    await expect(herramientas.listarFacturasVencidas(entrada)).rejects.toMatchObject({
      motivo: 'invalido',
    });
    expect(cliente.llamadas).toHaveLength(0);
  });
});

describe('crear_nota_seguimiento', () => {
  it('anota en el historial de la factura y devuelve la nota creada', async () => {
    const salida = await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Llamada al contacto de facturación: paga el día 25.',
    });
    expect(salida).toEqual({
      id: 9001,
      factura_id: 42,
      tipo: 'nota',
      // El `chatter_post` real no devuelve fecha de creación: se usa la del conector.
      creado_en: DIA_DE_LA_GRABACION.toISOString(),
    });
    expect(cliente.llamadas[0]?.herramienta).toBe('chatter_post');
  });

  it('crea la actividad por la puerta de escritura del MCP dinámico', async () => {
    const salida = await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Segundo aviso.',
      tipo: 'actividad',
      fecha_limite: '2026-10-01',
    });
    expect(salida.tipo).toBe('actividad');
    expect(salida.id).toBe(5501);
    expect(cliente.llamadas.map((llamada) => llamada.herramienta)).toEqual([
      'preview_write',
      'validate_write',
      'execute_approved_write',
    ]);
    expect(cliente.llamadas[2]?.argumentos).toEqual({
      approval_id: 'apr-2026-0001',
      confirm: true,
    });
  });

  it('con la misma clave de idempotencia devuelve la misma nota y no escribe dos veces', async () => {
    const entrada = {
      factura_id: 42,
      texto: 'Primer aviso enviado.',
      clave_idempotencia: 'tarea-7-paso-3',
    };
    const primera = await herramientas.crearNotaSeguimiento(entrada);
    const segunda = await herramientas.crearNotaSeguimiento(entrada);
    expect(segunda).toEqual(primera);
    expect(cliente.llamadas).toHaveLength(1);
  });

  it('la misma clave con otros datos se rechaza en vez de devolver la nota vieja', async () => {
    const clave_idempotencia = 'tarea-7-paso-3';
    await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Primer aviso enviado.',
      clave_idempotencia,
    });
    await expect(
      herramientas.crearNotaSeguimiento({
        factura_id: 43,
        texto: 'Otro aviso distinto.',
        clave_idempotencia,
      }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
    expect(cliente.llamadas).toHaveLength(1);
  });

  it('dos llamadas a la vez con la misma clave escriben una sola nota', async () => {
    const entrada = {
      factura_id: 42,
      texto: 'Aviso simultáneo.',
      clave_idempotencia: 'tarea-7-paso-4',
    };
    const [una, otra] = await Promise.all([
      herramientas.crearNotaSeguimiento(entrada),
      herramientas.crearNotaSeguimiento(entrada),
    ]);
    expect(otra).toEqual(una);
    expect(cliente.llamadas).toHaveLength(1);
  });

  it('una clave cuya escritura falló no deja nada guardado y se puede reintentar', async () => {
    const clave_idempotencia = 'tarea-7-paso-5';
    await expect(
      herramientas.crearNotaSeguimiento({
        factura_id: 777777,
        texto: 'Aviso.',
        clave_idempotencia,
      }),
    ).rejects.toMatchObject({ motivo: 'temporal' });
    const salida = await herramientas.crearNotaSeguimiento({
      factura_id: 42,
      texto: 'Aviso.',
      clave_idempotencia,
    });
    expect(salida.id).toBe(9001);
  });

  it('el detalle del ERP llega recortado, sin traza ni SQL', async () => {
    const conTraza = clienteGrabado({
      chatter_post: [
        {
          error: [
            'AccessError: no puedes modificar este documento',
            'Traceback (most recent call last):',
            'SELECT id, partner_id FROM account_move WHERE company_id = 1',
          ].join('\n'),
        },
      ],
    });
    const solo = crearHerramientas({ cliente: conTraza, ahora: () => DIA_DE_LA_GRABACION });
    try {
      await solo.crearNotaSeguimiento({ factura_id: 42, texto: 'Aviso.' });
      expect.unreachable('la llamada debía fallar');
    } catch (error) {
      const mensaje = (error as ErrorConector).message;
      expect((error as ErrorConector).motivo).toBe('no_autorizado');
      expect(mensaje).toContain('no puedes modificar este documento');
      expect(mensaje).not.toContain('Traceback');
      expect(mensaje).not.toContain('SELECT');
    }
  });

  it('sin clave de idempotencia cada llamada escribe', async () => {
    const entrada = { factura_id: 42, texto: 'Aviso.' };
    await herramientas.crearNotaSeguimiento(entrada);
    await herramientas.crearNotaSeguimiento(entrada);
    expect(cliente.llamadas).toHaveLength(2);
  });

  it.each([
    ['factura inexistente', 999999, 'no_encontrada', false],
    ['usuario sin permiso', 888888, 'no_autorizado', false],
    ['caída del ERP', 777777, 'temporal', true],
  ])('%s sale con motivo %s', async (_caso, facturaId, motivo, reintentable) => {
    try {
      await herramientas.crearNotaSeguimiento({ factura_id: facturaId, texto: 'Aviso.' });
      expect.unreachable('la llamada debía fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorConector);
      expect((error as ErrorConector).motivo).toBe(motivo);
      expect((error as ErrorConector).reintentable).toBe(reintentable);
      expect((error as ErrorConector).message).toMatch(/^No se pudo crear la nota de seguimiento:/);
    }
  });

  it.each([
    ['texto con HTML', { factura_id: 42, texto: '<b>urgente</b>' }],
    ['texto vacío', { factura_id: 42, texto: '' }],
    ['fecha límite en una nota', { factura_id: 42, texto: 'Aviso.', fecha_limite: '2026-10-01' }],
  ])('rechaza %s sin llegar al ERP', async (_caso, entrada) => {
    await expect(herramientas.crearNotaSeguimiento(entrada)).rejects.toMatchObject({
      motivo: 'invalido',
    });
    expect(cliente.llamadas).toHaveLength(0);
  });
});
