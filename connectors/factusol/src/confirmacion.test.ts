/** Confirmación B (ADR-031): coincide, no coincide, sin token, caducó, y la reanudación. */
import { describe, expect, it } from 'vitest';

import { almacenDeBorradoresEnMemoria } from './almacen-borradores.js';
import {
  OPERACION_CONFIRMAR,
  comprobarCoincidencia,
  confirmacionPorGateway,
  confirmacionPorPersona,
  leerOpcionDeConfirmacion,
  observacionesTrasAnotar,
} from './confirmacion.js';
import { DIA_DE_LA_GRABACION } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { simularFactusol, type OpcionesSimulador } from './simulador.js';

const ENTRADA = { factura_id: '1-000101', texto: 'Primer aviso de cobro.' };
const CON_CLAVE = { ...ENTRADA, clave_idempotencia: 'cobro-1' };
const LINEA = '[2026-09-21] Primer aviso de cobro.';

function montar(
  opciones: OpcionesSimulador = {},
  { token = true, borradores = almacenDeBorradoresEnMemoria() } = {},
): { herramientas: ReturnType<typeof crearHerramientas>; sim: ReturnType<typeof simularFactusol> } {
  const sim = simularFactusol(opciones);
  const confirmador = confirmacionPorGateway({
    cliente: sim.agente,
    clienteConfirmar: token ? sim.confirmar : undefined,
  });
  return {
    sim,
    herramientas: crearHerramientas({
      cliente: sim.agente,
      confirmador,
      borradores,
      ahora: () => DIA_DE_LA_GRABACION,
      registrar: () => undefined,
    }),
  };
}

const veces = (sim: ReturnType<typeof simularFactusol>, herramienta: string): number =>
  sim.llamadas.filter((l) => l.herramienta === herramienta).length;

describe('B · el borrador coincide con lo aprobado', () => {
  it('confirma ese borrador con el token de confirmación y escribe una vez', async () => {
    const { herramientas, sim } = montar();
    const salida = await herramientas.crearNotaSeguimiento(ENTRADA);

    expect(salida.id).toBe('dft_0002');
    expect(sim.observaciones()).toBe(`Cliente de prueba.\n${LINEA}`);
    const confirmaciones = sim.llamadas.filter((l) => l.herramienta === OPERACION_CONFIRMAR);
    expect(confirmaciones).toEqual([
      { via: 'confirmar', herramienta: OPERACION_CONFIRMAR, argumentos: { draft_id: 'dft_0002' } },
    ]);
    // El sondeo se canceló; el definitivo quedó ejecutado.
    expect(sim.borradores.get('dft_0001')?.estado).toBe('cancelado');
    expect(sim.borradores.get('dft_0002')?.estado).toBe('ya_ejecutado');
  });

  it('el cliente de confirmación solo llama a confirmar_operacion y el del agente nunca', async () => {
    const { herramientas, sim } = montar();
    await herramientas.crearNotaSeguimiento(ENTRADA);
    for (const llamada of sim.llamadas) {
      if (llamada.via === 'confirmar') expect(llamada.herramienta).toBe(OPERACION_CONFIRMAR);
      if (llamada.via === 'agente') expect(llamada.herramienta).not.toBe(OPERACION_CONFIRMAR);
    }
  });

  it('una lectura no usa nunca el cliente de confirmación', async () => {
    const { herramientas, sim } = montar();
    await herramientas.listarFacturasVencidas({});
    expect(sim.llamadas.every((l) => l.via === 'agente')).toBe(true);
  });
});

describe('B · el borrador no coincide', () => {
  it.each([
    [
      'cambia otro campo además de observaciones',
      {
        alterarCambios: (campos: Record<string, unknown>[]) => [
          ...campos,
          { nombre: 'Domicilio', valor_actual: 'Calle A', valor_nuevo: 'Calle B', cambia: true },
        ],
      },
    ],
    [
      'el valor nuevo no es el actual más la nota',
      {
        alterarCambios: (campos: Record<string, unknown>[]) =>
          campos.map((campo) => ({ ...campo, valor_nuevo: 'Otra cosa distinta.' })),
      },
    ],
    [
      'borra lo que había',
      {
        alterarCambios: (campos: Record<string, unknown>[]) =>
          campos.map((campo) => ({ ...campo, valor_nuevo: LINEA })),
      },
    ],
  ])('%s: cancela el borrador, no confirma y falla como invalido', async (_caso, opciones) => {
    const { herramientas, sim } = montar(opciones);
    await expect(herramientas.crearNotaSeguimiento(ENTRADA)).rejects.toMatchObject({
      motivo: 'invalido',
      reintentable: false,
    });
    expect(veces(sim, OPERACION_CONFIRMAR)).toBe(0);
    expect(sim.borradores.get('dft_0002')?.estado).toBe('cancelado');
    expect(sim.observaciones()).toBe('Cliente de prueba.');
  });

  it('un diff que no se puede leer no se confirma', async () => {
    const { herramientas, sim } = montar({ alterarCambios: () => [] });
    await expect(herramientas.crearNotaSeguimiento(ENTRADA)).rejects.toMatchObject({
      motivo: 'invalido',
    });
    expect(veces(sim, OPERACION_CONFIRMAR)).toBe(0);
    // Ni el borrador de sondeo, que no se entiende, queda pendiente.
    expect(sim.borradores.get('dft_0001')?.estado).toBe('cancelado');
  });

  it('comprobarCoincidencia acepta solo observaciones con actual más nota', () => {
    const base = {
      draftId: 'B',
      clienteCodigo: '12',
      facturaId: '1-000101',
      linea: LINEA,
    };
    const nuevo = observacionesTrasAnotar('Había esto.', LINEA);
    expect(() =>
      comprobarCoincidencia({
        ...base,
        observaciones: nuevo,
        cambios: new Map([['observaciones', { actual: 'Había esto.', nuevo }]]),
      }),
    ).not.toThrow();
    expect(() =>
      comprobarCoincidencia({
        ...base,
        observaciones: nuevo,
        cambios: new Map([
          ['observaciones', { actual: 'Había esto.', nuevo }],
          ['telefono', { actual: '1', nuevo: '2' }],
        ]),
      }),
    ).toThrowError(/algo más/);
  });
});

describe('B · sin el token de confirmación', () => {
  it('falla como no_autorizado y no deja ningún borrador', async () => {
    const { herramientas, sim } = montar({}, { token: false });
    await expect(herramientas.crearNotaSeguimiento(ENTRADA)).rejects.toMatchObject({
      motivo: 'no_autorizado',
      reintentable: false,
    });
    expect(sim.llamadas).toHaveLength(0);
    expect(sim.borradores.size).toBe(0);
  });

  it('las lecturas siguen funcionando sin él', async () => {
    const { herramientas } = montar({}, { token: false });
    await expect(herramientas.listarFacturasVencidas({})).resolves.toMatchObject({ total: 3 });
  });
});

describe('B · el borrador caducó', () => {
  it('si caduca antes de confirmarse, falla como temporal y no escribe', async () => {
    const { herramientas, sim } = montar({ caducaAlConfirmar: true });
    await expect(herramientas.crearNotaSeguimiento(ENTRADA)).rejects.toMatchObject({
      motivo: 'temporal',
      reintentable: true,
    });
    expect(sim.observaciones()).toBe('Cliente de prueba.');
  });

  it('el servidor que bloquea la confirmación con el token del agente no escribe nada', async () => {
    const sim = simularFactusol();
    await sim.agente.llamar('draft_modificar_cliente', { cliente: '12', observaciones: 'x' });
    await expect(sim.agente.llamar(OPERACION_CONFIRMAR, { draft_id: 'dft_0001' })).rejects.toThrow(
      /no puede confirmar/,
    );
    expect(sim.observaciones()).toBe('Cliente de prueba.');
  });
});

describe('B · reanudación tras una caída entre el borrador y la confirmación', () => {
  it('con la misma clave confirma el mismo borrador y no crea otro', async () => {
    let falla = true;
    const borradores = almacenDeBorradoresEnMemoria();
    const { herramientas, sim } = montar(
      { confirmarFalla: () => (falla ? 'Read timed out' : undefined) },
      { borradores },
    );
    await expect(herramientas.crearNotaSeguimiento(CON_CLAVE)).rejects.toMatchObject({
      motivo: 'temporal',
    });
    const creados = veces(sim, 'draft_modificar_cliente');
    expect(creados).toBe(2);

    falla = false;
    const salida = await herramientas.crearNotaSeguimiento(CON_CLAVE);

    expect(veces(sim, 'draft_modificar_cliente')).toBe(creados);
    expect(veces(sim, 'get_estado_borrador')).toBeGreaterThan(0);
    expect(salida.id).toBe('dft_0002');
    expect(sim.observaciones()).toBe(`Cliente de prueba.\n${LINEA}`);
  });

  it('un proceso nuevo con la memoria durable encuentra la nota ya escrita y no confirma de nuevo', async () => {
    const borradores = almacenDeBorradoresEnMemoria();
    const primero = montar({}, { borradores });
    const original = await primero.herramientas.crearNotaSeguimiento(CON_CLAVE);

    // Proceso nuevo: sin la memoria de idempotencia del anterior, con el mismo Factusol y el mismo almacén.
    const confirmador = confirmacionPorGateway({
      cliente: primero.sim.agente,
      clienteConfirmar: primero.sim.confirmar,
    });
    const reiniciado = crearHerramientas({
      cliente: primero.sim.agente,
      confirmador,
      borradores,
      ahora: () => DIA_DE_LA_GRABACION,
      registrar: () => undefined,
    });
    const confirmacionesAntes = veces(primero.sim, OPERACION_CONFIRMAR);
    const creadosAntes = veces(primero.sim, 'draft_modificar_cliente');

    expect(await reiniciado.crearNotaSeguimiento(CON_CLAVE)).toEqual(original);
    expect(veces(primero.sim, OPERACION_CONFIRMAR)).toBe(confirmacionesAntes);
    expect(veces(primero.sim, 'draft_modificar_cliente')).toBe(creadosAntes);
  });

  it('si el borrador guardado caducó, crea uno nuevo y lo confirma', async () => {
    const borradores = almacenDeBorradoresEnMemoria();
    let falla = true;
    const { herramientas, sim } = montar(
      { confirmarFalla: () => (falla ? 'Read timed out' : undefined) },
      { borradores },
    );
    await expect(herramientas.crearNotaSeguimiento(CON_CLAVE)).rejects.toBeDefined();
    const viejo = sim.borradores.get('dft_0002');
    if (viejo) viejo.estado = 'caducado';
    falla = false;

    const salida = await herramientas.crearNotaSeguimiento(CON_CLAVE);
    expect(salida.id).toBe('dft_0004');
    expect(sim.observaciones()).toBe(`Cliente de prueba.\n${LINEA}`);
  });

  it('la misma clave con otros datos es invalido también con la memoria durable', async () => {
    const borradores = almacenDeBorradoresEnMemoria();
    const { herramientas } = montar({ confirmarFalla: () => 'Read timed out' }, { borradores });
    await expect(herramientas.crearNotaSeguimiento(CON_CLAVE)).rejects.toBeDefined();
    await expect(
      herramientas.crearNotaSeguimiento({ ...CON_CLAVE, texto: 'Otro texto.' }),
    ).rejects.toMatchObject({ motivo: 'invalido' });
  });
});

describe('A y la selección', () => {
  it('A deja el borrador pendiente y no confirma', async () => {
    const sim = simularFactusol();
    const herramientas = crearHerramientas({
      cliente: sim.agente,
      confirmador: confirmacionPorPersona(sim.agente),
      ahora: () => DIA_DE_LA_GRABACION,
      registrar: () => undefined,
    });
    await herramientas.crearNotaSeguimiento(ENTRADA);
    expect(veces(sim, OPERACION_CONFIRMAR)).toBe(0);
    expect(sim.borradores.get('dft_0002')?.estado).toBe('pendiente');
  });

  it('por defecto es B y solo se admiten A y B', () => {
    expect(leerOpcionDeConfirmacion(undefined)).toBe('B');
    expect(leerOpcionDeConfirmacion('a')).toBe('A');
    expect(() => leerOpcionDeConfirmacion('C')).toThrowError(/solo A o B/);
  });
});
