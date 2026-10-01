/** Las dos herramientas sobre un cliente simulado: lectura, nota por observaciones e idempotencia. */
import { describe, expect, it } from 'vitest';

import { clienteGrabado, type ClienteFactusol, type RespuestaFactusol } from './cliente.js';
import {
  DIA_DE_LA_GRABACION,
  cargarGrabaciones,
  vencimientoDePrueba,
} from './grabaciones/index.js';
import { crearHerramientas, lineaDeObservacion, sinVencimiento } from './herramientas.js';

function montar(
  opciones: Partial<Parameters<typeof crearHerramientas>[0]> = {},
  cliente: ClienteFactusol = clienteGrabado(cargarGrabaciones()),
): { herramientas: ReturnType<typeof crearHerramientas>; registro: string[] } {
  const registro: string[] = [];
  return {
    registro,
    herramientas: crearHerramientas({
      cliente,
      ahora: () => DIA_DE_LA_GRABACION,
      vencimiento: vencimientoDePrueba,
      registrar: (mensaje) => registro.push(mensaje),
      ...opciones,
    }),
  };
}

describe('listar_facturas_vencidas', () => {
  it('devuelve las vencidas de más a menos días, con ids nativos', async () => {
    const { herramientas } = montar();
    const salida = await herramientas.listarFacturasVencidas({});
    expect(salida.total).toBe(2);
    expect(salida.facturas.map((factura) => factura.id)).toEqual(['1-000101', '1-000102']);
    expect(salida.facturas[0]).toEqual({
      id: '1-000101',
      numero: '1-000101',
      cliente: { id: '12', nombre: 'EJEMPLO UNO S.L.' },
      importe_pendiente: 121,
      moneda: 'EUR',
      fecha_emision: '2026-07-01',
      fecha_vencimiento: '2026-07-31',
      dias_vencida: 52,
    });
  });

  it('nunca devuelve una factura no vencida ni por debajo del mínimo pedido', async () => {
    const { herramientas } = montar();
    const salida = await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 30 });
    expect(salida.facturas.map((factura) => factura.id)).toEqual(['1-000101']);
    // dias_vencida_minimo 0 sigue exigiendo al menos un día.
    const conCero = await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 0 });
    expect(conCero.facturas.every((factura) => factura.dias_vencida >= 1)).toBe(true);
  });

  it('recorta por límite', async () => {
    const { herramientas } = montar();
    expect((await herramientas.listarFacturasVencidas({ limite: 1 })).total).toBe(1);
  });

  it('sin vencimiento derivable no devuelve la factura y la cuenta en el registro', async () => {
    const { herramientas, registro } = montar({ vencimiento: sinVencimiento });
    const salida = await herramientas.listarFacturasVencidas({});
    expect(salida).toEqual({ facturas: [], total: 0 });
    expect(registro.join('\n')).toContain('facturas_sin_vencimiento=4');
  });

  it('una factura con cobros sin importe legible no se devuelve y se cuenta', async () => {
    const { herramientas, registro } = montar();
    await herramientas.listarFacturasVencidas({});
    expect(registro.join('\n')).toContain('con_cobros_sin_importe=1');
  });

  it('el registro lleva recuentos, nunca nombres, NIF ni importes', async () => {
    const { herramientas, registro } = montar();
    await herramientas.listarFacturasVencidas({});
    const todo = registro.join('\n');
    expect(todo).not.toMatch(/EJEMPLO|MUESTRA|B00000001|121/);
  });

  it('una entrada fuera de rango es invalido y no llega a Factusol', async () => {
    const cliente = clienteGrabado(cargarGrabaciones());
    const { herramientas } = montar({}, cliente);
    for (const entrada of [{ limite: 0 }, { limite: 201 }, { dias_vencida_minimo: -1 }, { x: 1 }]) {
      await expect(herramientas.listarFacturasVencidas(entrada)).rejects.toMatchObject({
        motivo: 'invalido',
      });
    }
    expect(cliente.llamadas).toHaveLength(0);
  });

  it('un bloque que no encaja es invalido y no sale ningún dato', async () => {
    const grabaciones = {
      ...cargarGrabaciones(),
      list_facturas_emitidas: [{ texto: '**Factura 1-000101**\n- Cliente: SIN NIF\n' }],
    };
    const { herramientas } = montar({}, clienteGrabado(grabaciones));
    await expect(herramientas.listarFacturasVencidas({})).rejects.toMatchObject({
      motivo: 'invalido',
    });
  });

  it('un fallo de transporte es temporal y reintentable', async () => {
    const grabaciones = {
      ...cargarGrabaciones(),
      list_facturas_emitidas: [{ error: 'Read timed out after 60s' }],
    };
    const { herramientas } = montar({}, clienteGrabado(grabaciones));
    await expect(herramientas.listarFacturasVencidas({})).rejects.toMatchObject({
      motivo: 'temporal',
      reintentable: true,
    });
  });
});

/** Cliente con estado: cada borrador de modificación relee las observaciones vigentes. */
function clienteConObservaciones(inicial: string): ClienteFactusol & {
  llamadas: { herramienta: string; argumentos: Record<string, unknown> }[];
  cancelados: string[];
  borradores: { id: string; observaciones: string }[];
} {
  const base = clienteGrabado(cargarGrabaciones());
  const llamadas: { herramienta: string; argumentos: Record<string, unknown> }[] = [];
  const cancelados: string[] = [];
  const borradores: { id: string; observaciones: string }[] = [];
  return {
    llamadas,
    cancelados,
    borradores,
    async llamar(herramienta, argumentos): Promise<RespuestaFactusol> {
      llamadas.push({ herramienta, argumentos });
      if (herramienta === 'draft_modificar_cliente') {
        const id = `BORR-${String(borradores.length + 1).padStart(4, '0')}`;
        borradores.push({ id, observaciones: String(argumentos['observaciones']) });
        return {
          texto: '',
          estructurado: {
            draft_id: id,
            cambios: { observaciones: { valor_actual: inicial } },
          },
        };
      }
      if (herramienta === 'cancelar_borrador') {
        cancelados.push(String(argumentos['draft_id']));
        return { texto: 'Borrador cancelado.' };
      }
      return base.llamar(herramienta, argumentos);
    },
    cerrar: () => Promise.resolve(),
  };
}

describe('crear_nota_seguimiento', () => {
  const entrada = { factura_id: '1-000101', texto: 'Primer aviso de cobro.' };

  it('añade al final de las observaciones, con fecha, sin borrar lo que había', async () => {
    const cliente = clienteConObservaciones('Cliente de prueba.');
    const { herramientas } = montar({}, cliente);
    const salida = await herramientas.crearNotaSeguimiento(entrada);
    expect(salida).toEqual({
      id: 'BORR-0002',
      factura_id: '1-000101',
      tipo: 'nota',
      creado_en: '2026-09-21T09:00:00.000Z',
    });
    expect(cliente.borradores.at(-1)?.observaciones).toBe(
      'Cliente de prueba.\n[2026-09-21] Primer aviso de cobro.',
    );
    // El borrador de sondeo se cancela; el definitivo queda pendiente.
    expect(cliente.cancelados).toEqual(['BORR-0001']);
  });

  it('con observaciones vacías deja solo la línea nueva', async () => {
    const cliente = clienteConObservaciones('');
    await montar({}, cliente).herramientas.crearNotaSeguimiento(entrada);
    expect(cliente.borradores.at(-1)?.observaciones).toBe('[2026-09-21] Primer aviso de cobro.');
  });

  it('escribe en el cliente de la factura, resuelto por NIF', async () => {
    const cliente = clienteConObservaciones('');
    await montar({}, cliente).herramientas.crearNotaSeguimiento(entrada);
    const borrador = cliente.llamadas.find((l) => l.herramienta === 'draft_modificar_cliente');
    expect(borrador?.argumentos['cliente']).toBe('12');
  });

  it('nunca llama a confirmar_operacion', async () => {
    const cliente = clienteConObservaciones('x');
    await montar({}, cliente).herramientas.crearNotaSeguimiento(entrada);
    expect(cliente.llamadas.map((l) => l.herramienta)).not.toContain('confirmar_operacion');
  });

  it('una actividad con fecha límite la lleva dentro del texto', () => {
    expect(
      lineaDeObservacion(
        { factura_id: '1-000101', texto: 'Llamar.', tipo: 'actividad', fecha_limite: '2026-10-05' },
        DIA_DE_LA_GRABACION,
      ),
    ).toBe('[2026-09-21] Llamar. (Fecha límite: 2026-10-05)');
  });

  it.each([
    ['texto vacío', { factura_id: '1-000101', texto: '' }],
    ['más de 2000 caracteres', { factura_id: '1-000101', texto: 'a'.repeat(2001) }],
    ['con HTML', { factura_id: '1-000101', texto: '<b>hola</b>' }],
    ['fecha límite con nota', { factura_id: '1-000101', texto: 'x', fecha_limite: '2026-10-05' }],
    ['factura sin serie-número', { factura_id: '42', texto: 'x' }],
  ])('%s es invalido y no escribe', async (_caso, mala) => {
    const cliente = clienteConObservaciones('');
    await expect(montar({}, cliente).herramientas.crearNotaSeguimiento(mala)).rejects.toMatchObject(
      {
        motivo: 'invalido',
      },
    );
    expect(cliente.borradores).toHaveLength(0);
  });

  it('una factura inexistente es no_encontrada', async () => {
    const cliente = clienteConObservaciones('');
    await expect(
      montar({}, cliente).herramientas.crearNotaSeguimiento({
        factura_id: '1-999999',
        texto: 'x',
      }),
    ).rejects.toMatchObject({ motivo: 'no_encontrada' });
    expect(cliente.borradores).toHaveLength(0);
  });

  it('un token sin permiso es no_autorizado', async () => {
    const grabaciones = {
      ...cargarGrabaciones(),
      draft_modificar_cliente: [{ error: '403 Forbidden: falta el scope borrador' }],
    };
    await expect(
      montar({}, clienteGrabado(grabaciones)).herramientas.crearNotaSeguimiento(entrada),
    ).rejects.toMatchObject({ motivo: 'no_autorizado' });
  });

  it('un borrador con otra forma es invalido y no deja nada pendiente', async () => {
    const grabaciones = {
      ...cargarGrabaciones(),
      draft_modificar_cliente: [{ estructurado: { estado: 'raro' } }],
    };
    await expect(
      montar({}, clienteGrabado(grabaciones)).herramientas.crearNotaSeguimiento(entrada),
    ).rejects.toMatchObject({ motivo: 'invalido' });
  });

  describe('idempotencia', () => {
    const conClave = { ...entrada, clave_idempotencia: 'cobro-1' };

    it('la misma clave devuelve la misma nota sin escribir otra vez', async () => {
      const cliente = clienteConObservaciones('');
      const { herramientas } = montar({}, cliente);
      const primera = await herramientas.crearNotaSeguimiento(conClave);
      const segunda = await herramientas.crearNotaSeguimiento(conClave);
      expect(segunda).toEqual(primera);
      expect(cliente.borradores).toHaveLength(2); // sondeo + definitivo, una sola vez
    });

    it('la misma clave con otros datos es invalido', async () => {
      const { herramientas } = montar({}, clienteConObservaciones(''));
      await herramientas.crearNotaSeguimiento(conClave);
      await expect(
        herramientas.crearNotaSeguimiento({ ...conClave, texto: 'Otro texto.' }),
      ).rejects.toMatchObject({ motivo: 'invalido' });
    });

    it('dos llamadas simultáneas escriben una sola vez', async () => {
      const cliente = clienteConObservaciones('');
      const { herramientas } = montar({}, cliente);
      const [una, otra] = await Promise.all([
        herramientas.crearNotaSeguimiento(conClave),
        herramientas.crearNotaSeguimiento(conClave),
      ]);
      expect(otra).toEqual(una);
      expect(cliente.borradores).toHaveLength(2);
    });

    it('tras una escritura fallida la clave se puede reintentar', async () => {
      let fallar = true;
      const interno = clienteConObservaciones('');
      const cliente: ClienteFactusol = {
        llamar: (herramienta, argumentos) => {
          if (fallar && herramienta === 'draft_modificar_cliente') {
            fallar = false;
            return Promise.reject(new Error('Read timed out'));
          }
          return interno.llamar(herramienta, argumentos);
        },
        cerrar: () => Promise.resolve(),
      };
      const { herramientas } = montar({}, cliente);
      await expect(herramientas.crearNotaSeguimiento(conClave)).rejects.toMatchObject({
        motivo: 'temporal',
        reintentable: true,
      });
      await expect(herramientas.crearNotaSeguimiento(conClave)).resolves.toMatchObject({
        factura_id: '1-000101',
      });
    });
  });
});
