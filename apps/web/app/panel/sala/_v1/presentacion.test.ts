import { describe, expect, it } from 'vitest';

import type { MiembroDeSala } from '../../../../lib/sala-contrato';
import {
  aMiembroVisible,
  aplicarPresencia,
  colorDeAgente,
  escribiendoAhora,
  haceCuanto,
  resumenDePresencia,
} from './presentacion';

function en<T>(lista: readonly T[], indice: number): T {
  const valor = lista[indice];
  if (valor === undefined) throw new Error(`Falta el elemento ${indice}`);
  return valor;
}

const AHORA = Date.parse('2026-09-28T10:00:00Z');
const hace = (ms: number) => new Date(AHORA - ms).toISOString();

const MIEMBROS: MiembroDeSala[] = [
  { id: 'yo', tipo: 'persona', nombre: 'Lucía Ferrán', equipo: 'Gerencia', estado: 'en-la-sala' },
  {
    id: 'p2',
    tipo: 'persona',
    nombre: 'Tomás Rivel',
    equipo: 'Administración',
    estado: 'inactivo',
    desde: hace(15 * 60_000),
  },
  {
    id: 'p3',
    tipo: 'persona',
    nombre: 'Asesoría Olmo',
    estado: 'anadido',
    desde: hace(26 * 3_600_000),
  },
  {
    id: 'a1',
    tipo: 'agente',
    nombre: 'Cobros',
    equipo: 'Finanzas',
    estado: 'te-necesita',
    desde: hace(6 * 60_000),
  },
  { id: 'a2', tipo: 'agente', nombre: 'Previsión', estado: 'en-pausa', desde: hace(3 * 3_600_000) },
  { id: 'a3', tipo: 'agente', nombre: 'Director de IA', estado: 'escribiendo' },
];

describe('haceCuanto', () => {
  it('redacta minutos, horas, ayer y días', () => {
    expect(haceCuanto(hace(10_000), AHORA)).toBe('ahora');
    expect(haceCuanto(hace(15 * 60_000), AHORA)).toBe('15 min');
    expect(haceCuanto(hace(3 * 3_600_000), AHORA)).toBe('3 h');
    expect(haceCuanto(hace(26 * 3_600_000), AHORA)).toBe('ayer');
    expect(haceCuanto(hace(4 * 86_400_000), AHORA)).toBe('4 días');
  });

  it('sin fecha o con una fecha rota no inventa nada', () => {
    expect(haceCuanto(undefined, AHORA)).toBeUndefined();
    expect(haceCuanto('no es una fecha', AHORA)).toBeUndefined();
    // Una fecha futura por desajuste de relojes se lee como «ahora».
    expect(haceCuanto(new Date(AHORA + 60_000).toISOString(), AHORA)).toBe('ahora');
  });
});

describe('aMiembroVisible', () => {
  it('marca a quien mira y pone su equipo', () => {
    expect(aMiembroVisible(en(MIEMBROS, 0), 'yo', AHORA)).toMatchObject({
      contexto: 'Gerencia · eres tú',
    });
  });

  it('pone cuánto hace en los estados que lo necesitan', () => {
    expect(aMiembroVisible(en(MIEMBROS, 1), 'yo', AHORA)).toMatchObject({
      contexto: 'Administración',
      detalle: 'hace 15 min',
    });
    expect(aMiembroVisible(en(MIEMBROS, 2), 'yo', AHORA).detalle).toBe('sin conectar desde ayer');
    expect(aMiembroVisible(en(MIEMBROS, 4), 'yo', AHORA).detalle).toBe('hace 3 h');
    expect(aMiembroVisible(en(MIEMBROS, 5), 'yo', AHORA).detalle).toBeUndefined();
  });

  it('los agentes llevan color estable y sin contexto de equipo', () => {
    const visible = aMiembroVisible(en(MIEMBROS, 3), 'yo', AHORA);
    expect(visible.contexto).toBeUndefined();
    expect(visible.color).toBe(colorDeAgente('a1'));
    expect(colorDeAgente('a1')).toBe(colorDeAgente('a1'));
  });
});

describe('resumenDePresencia', () => {
  it('cuenta en la sala, inactivos (con en pausa) y añadidos', () => {
    expect(resumenDePresencia(MIEMBROS)).toBe('3 en la sala · 2 inactivos · 1 añadido');
    expect(resumenDePresencia([en(MIEMBROS, 0)])).toBe('1 en la sala');
    expect(resumenDePresencia([])).toBe('0 en la sala');
  });
});

describe('aplicarPresencia', () => {
  it('sustituye al miembro que cambia y añade al que llega', () => {
    const cambiado = aplicarPresencia(MIEMBROS, {
      tipo: 'presencia',
      salaId: 'finanzas',
      miembro: { ...en(MIEMBROS, 3), estado: 'en-la-sala' },
    });
    expect(cambiado.find((m) => m.id === 'a1')?.estado).toBe('en-la-sala');
    expect(cambiado).toHaveLength(MIEMBROS.length);

    const nuevo = aplicarPresencia(MIEMBROS, {
      tipo: 'presencia',
      salaId: 'finanzas',
      miembro: { id: 'nuevo', tipo: 'agente', nombre: 'Marketing', estado: 'anadido' },
    });
    expect(nuevo).toHaveLength(MIEMBROS.length + 1);
  });
});

describe('escribiendoAhora', () => {
  it('solo cuenta avisos vigentes y nunca a quien mira', () => {
    const futuro = new Date(AHORA + 5_000).toISOString();
    const pasado = new Date(AHORA - 5_000).toISOString();
    expect(escribiendoAhora({ a3: futuro, a1: pasado, yo: futuro }, MIEMBROS, 'yo', AHORA)).toEqual(
      ['Director de IA'],
    );
    expect(escribiendoAhora({}, MIEMBROS, 'yo', AHORA)).toEqual([]);
  });
});
