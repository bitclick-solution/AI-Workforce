import { describe, expect, it } from 'vitest';

import {
  LIMITE_MAXIMO,
  aparece,
  moderar,
  normalizar,
  pideContratar,
  type ParticipanteDeSala,
} from './moderador';

const COBROS: ParticipanteDeSala = {
  puestoId: 'p-cobros',
  nombre: 'Cobros',
  estado: 'activo',
  temas: ['cobro', 'factura vencida', 'moroso'],
};
const CONCILIACION: ParticipanteDeSala = {
  puestoId: 'p-conciliacion',
  nombre: 'Conciliación bancaria',
  estado: 'en_prueba',
  temas: ['concilia', 'banco', 'apunte', 'cobro'],
};
const PREVISION: ParticipanteDeSala = {
  puestoId: 'p-prevision',
  nombre: 'Previsión de tesorería',
  estado: 'pausado',
  temas: ['tesoreria', 'prevision', 'cobro'],
};
const SALA = [COBROS, CONCILIACION, PREVISION];

describe('normalizar y aparece', () => {
  it('quita tildes y puntuación y conserva la arroba', () => {
    expect(normalizar('¿Cómo vamos de COBROS, @Conciliación?')).toBe(
      'como vamos de cobros @conciliacion',
    );
  });

  it('encaja raíces al principio de palabra y expresiones seguidas', () => {
    expect(aparece('cobro', '¿cómo vamos de cobros?')).toBe(true);
    expect(aparece('factura vencida', 'hay facturas vencidas')).toBe(true);
    expect(aparece('factura vencida', 'facturas que no han vencido')).toBe(false);
    expect(aparece('cobro', 'recobrar')).toBe(false);
    expect(aparece('', 'lo que sea')).toBe(false);
  });
});

describe('moderar', () => {
  it('da la palabra a Cobros ante «¿cómo vamos de cobros este mes?»', () => {
    const decision = moderar('¿cómo vamos de cobros este mes?', SALA);
    expect(decision.tipo).toBe('intervenir');
    if (decision.tipo !== 'intervenir') return;
    expect(decision.turnos.map((t) => t.puestoId)).toEqual(['p-cobros']);
    expect(decision.turnos[0]?.motivo).toContain('«cobro»');
    expect(decision.turnos[0]?.porMencion).toBe(false);
  });

  it('prefiere el puesto con más temas y, a igualdad, el activo', () => {
    const conBanco = moderar('los cobros del banco sin conciliar', SALA);
    expect(conBanco.tipo === 'intervenir' && conBanco.turnos[0]?.puestoId).toBe('p-conciliacion');
  });

  it('nunca da más de dos turnos sin mención, aunque se pida más', () => {
    const decision = moderar('¿cómo van los cobros?', SALA, { limite: 5 });
    expect(decision.tipo === 'intervenir' && decision.turnos.length).toBe(2);
    expect(LIMITE_MAXIMO).toBe(2);
    const invalido = moderar('¿cómo van los cobros?', SALA, { limite: 0 });
    expect(invalido.tipo === 'intervenir' && invalido.turnos.length).toBe(1);
  });

  it('obedece a una mención aunque el tema no sea suyo', () => {
    const decision = moderar('@Conciliación ¿qué tal el día?', SALA);
    expect(decision.tipo === 'intervenir' && decision.turnos.map((t) => t.puestoId)).toEqual([
      'p-conciliacion',
    ]);
    expect(decision.tipo === 'intervenir' && decision.turnos[0]?.porMencion).toBe(true);
  });

  it('una mención a todo el equipo hace hablar a todos los disponibles', () => {
    const decision = moderar('@todos resumen de la semana', SALA);
    expect(decision.tipo === 'intervenir' && decision.turnos.length).toBe(2);
  });

  it('un puesto pausado no habla ni con mención ni con tema', () => {
    const decision = moderar('@Previsión ¿cómo va la tesorería?', SALA);
    expect(decision.tipo).toBe('silencio');
  });

  it('calla y lo dice cuando nadie tiene el tema', () => {
    const decision = moderar('¿quién trae el café mañana?', SALA);
    expect(decision).toMatchObject({ tipo: 'silencio' });
    expect(decision.motivo).toContain('Ningún agente');
    expect(moderar('@todos hola', []).tipo).toBe('silencio');
  });

  it('pasa la contratación al Director de IA sin dar la palabra a nadie', () => {
    const decision = moderar('contrata un agente de conciliación en Finanzas', SALA);
    expect(decision).toMatchObject({ tipo: 'operacion', operacion: 'contratar' });
    expect(pideContratar('Necesito alguien que reclame facturas')).toBe(true);
    expect(pideContratar('¿cómo vamos de cobros?')).toBe(false);
  });
});
