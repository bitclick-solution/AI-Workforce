import { afterEach, describe, expect, it, vi } from 'vitest';

import { BANDERA_SALA_V1, salaV1Activa } from './sala-bandera';
import type { CambioDeSala, EstadoDePresencia } from './sala-contrato';
import { crearFuente } from './sala-fuente';
import {
  DURACION_ESCRITURA_MS,
  RENOVAR_ESCRITURA_MS,
  conversacionSimulada,
  crearFuenteSimulada,
} from './sala-simulada';

const TODOS_LOS_ESTADOS: EstadoDePresencia[] = [
  'en-la-sala',
  'escribiendo',
  'inactivo',
  'anadido',
  'trabajando',
  'te-necesita',
  'en-pausa',
];

afterEach(() => {
  vi.useRealTimers();
});

describe('bandera AIW_SALA_V1', () => {
  it('se activa con 1 o true y con nada más', () => {
    expect(BANDERA_SALA_V1).toBe('AIW_SALA_V1');
    expect(salaV1Activa({ AIW_SALA_V1: '1' })).toBe(true);
    expect(salaV1Activa({ AIW_SALA_V1: 'true' })).toBe(true);
    expect(salaV1Activa({ AIW_SALA_V1: ' 1 ' })).toBe(true);
    expect(salaV1Activa({ AIW_SALA_V1: '0' })).toBe(false);
    expect(salaV1Activa({ AIW_SALA_V1: 'si' })).toBe(false);
    expect(salaV1Activa({})).toBe(false);
    expect(salaV1Activa({ AIW_SALA_V0: '1' })).toBe(false);
  });
});

describe('fuente simulada', () => {
  it('la fuente de la vista es hoy la simulada y cumple el contrato', async () => {
    const fuente = crearFuente();
    expect((await fuente.salas()).length).toBeGreaterThan(0);
  });

  it('tiene la sala general y salas de equipo con sin leer y menciones', async () => {
    const salas = await crearFuenteSimulada().salas();
    expect(salas.some((sala) => sala.ambito === 'general')).toBe(true);
    expect(salas.filter((sala) => sala.ambito === 'equipo').length).toBeGreaterThanOrEqual(2);
    expect(salas.some((sala) => sala.menciones > 0)).toBe(true);
    expect(salas.some((sala) => sala.sinLeer > 0 && sala.menciones === 0)).toBe(true);
  });

  it('cubre los siete estados del ADR-022 y los tres de agente solo en agentes', async () => {
    const miembros = await crearFuenteSimulada().miembros('finanzas');
    const estados = new Set(miembros.map((miembro) => miembro.estado));
    for (const estado of TODOS_LOS_ESTADOS) expect(estados).toContain(estado);
    for (const miembro of miembros) {
      if (['trabajando', 'te-necesita', 'en-pausa'].includes(miembro.estado)) {
        expect(miembro.tipo).toBe('agente');
      }
    }
    expect(miembros.some((miembro) => miembro.tipo === 'persona')).toBe(true);
  });

  it('pone desde relativo al reloj inyectado', async () => {
    const ahora = Date.parse('2026-09-28T10:00:00Z');
    const miembros = await crearFuenteSimulada({ ahora: () => ahora }).miembros('finanzas');
    const inactivo = miembros.find((miembro) => miembro.estado === 'inactivo');
    expect(inactivo?.desde).toBe('2026-09-28T09:45:00.000Z');
  });

  it('una sala desconocida no tiene miembros ni conversación', async () => {
    expect(await crearFuenteSimulada().miembros('no-existe')).toEqual([]);
    expect(conversacionSimulada('no-existe')).toEqual([]);
    expect(conversacionSimulada('finanzas').some((m) => m.tipo === 'aprobacion')).toBe(true);
    expect(conversacionSimulada('finanzas').some((m) => m.tipo === 'propuesta')).toBe(true);
  });

  it('falla con un error legible cuando se le pide', async () => {
    const fuente = crearFuenteSimulada({ fallar: true });
    await expect(fuente.salas()).rejects.toThrow('La sala simulada no responde.');
    await expect(fuente.miembros('finanzas')).rejects.toThrow();
  });

  it('avisa de la escritura en vivo, la renueva y deja de avisar al darse de baja', () => {
    vi.useFakeTimers();
    const ahora = Date.parse('2026-09-28T10:00:00Z');
    const fuente = crearFuenteSimulada({ ahora: () => ahora });
    const cambios: CambioDeSala[] = [];
    const baja = fuente.suscribir('finanzas', (cambio) => cambios.push(cambio));

    vi.advanceTimersByTime(0);
    expect(cambios).toHaveLength(1);
    const [primero] = cambios;
    expect(primero).toMatchObject({ tipo: 'escribiendo', salaId: 'finanzas' });
    if (primero?.tipo === 'escribiendo') {
      expect(Date.parse(primero.hasta) - ahora).toBe(DURACION_ESCRITURA_MS);
    }

    vi.advanceTimersByTime(RENOVAR_ESCRITURA_MS);
    expect(cambios).toHaveLength(2);

    baja();
    vi.advanceTimersByTime(RENOVAR_ESCRITURA_MS * 3);
    expect(cambios).toHaveLength(2);
  });

  it('sin escritura en vivo no emite nada solo', () => {
    vi.useFakeTimers();
    const fuente = crearFuenteSimulada({ escrituraEnVivo: false });
    const alCambiar = vi.fn();
    fuente.suscribir('finanzas', alCambiar);
    vi.advanceTimersByTime(RENOVAR_ESCRITURA_MS * 2);
    expect(alCambiar).not.toHaveBeenCalled();
  });

  it('emite los cambios de presencia a quien está suscrito a esa sala', async () => {
    const fuente = crearFuenteSimulada({ escrituraEnVivo: false });
    const enFinanzas = vi.fn();
    const enMarketing = vi.fn();
    fuente.suscribir('finanzas', enFinanzas);
    fuente.suscribir('marketing', enMarketing);

    fuente.cambiarPresencia('finanzas', 'agente-cobros', 'en-la-sala');

    expect(enFinanzas).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'presencia',
        salaId: 'finanzas',
        miembro: expect.objectContaining({ id: 'agente-cobros', estado: 'en-la-sala' }),
      }),
    );
    expect(enMarketing).not.toHaveBeenCalled();
    const miembros = await fuente.miembros('finanzas');
    expect(miembros.find((m) => m.id === 'agente-cobros')?.estado).toBe('en-la-sala');
    // Un miembro que no existe no rompe nada ni emite.
    fuente.cambiarPresencia('finanzas', 'no-existe', 'inactivo');
    expect(enFinanzas).toHaveBeenCalledTimes(1);
  });

  it('registra cuándo la persona indica que escribe', () => {
    const fuente = crearFuenteSimulada();
    fuente.indicarEscritura('finanzas');
    expect(fuente.escriturasIndicadas).toEqual(['finanzas']);
  });

  it('solo usa nombres sintéticos, sin correos ni teléfonos', async () => {
    const fuente = crearFuenteSimulada();
    const texto = JSON.stringify([
      await fuente.miembros('finanzas'),
      conversacionSimulada('finanzas'),
      conversacionSimulada('general'),
    ]);
    expect(texto).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(texto).not.toMatch(/\+?\d{3}[\s-]?\d{3}[\s-]?\d{3}/);
    expect(texto).not.toMatch(/ES\d{2}\s?\d{4}/);
  });
});
