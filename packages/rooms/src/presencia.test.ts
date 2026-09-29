import { describe, expect, it } from 'vitest';

import {
  DURACION_ESCRIBIENDO_MS,
  UMBRAL_INACTIVIDAD_MS,
  calcularEstadoDePresencia,
  type EntradaPresenciaAgente,
  type EntradaPresenciaPersona,
} from './presencia';

const AHORA = 1_000_000;

function persona(parcial: Partial<EntradaPresenciaPersona> = {}): EntradaPresenciaPersona {
  return { tipo: 'persona', conectada: true, ultimaActividadMs: AHORA, ahoraMs: AHORA, ...parcial };
}

function agente(parcial: Partial<EntradaPresenciaAgente> = {}): EntradaPresenciaAgente {
  return {
    tipo: 'agente',
    estadoPuesto: 'activo',
    tareaEnCurso: false,
    aprobacionPendiente: false,
    ahoraMs: AHORA,
    ...parcial,
  };
}

describe('calcularEstadoDePresencia', () => {
  it('persona conectada y activa: en-la-sala', () => {
    expect(calcularEstadoDePresencia(persona())).toBe('en-la-sala');
  });

  it('persona recién añadida, sin actividad previa: en-la-sala', () => {
    expect(calcularEstadoDePresencia(persona({ ultimaActividadMs: null }))).toBe('en-la-sala');
  });

  it('persona conectada sin actividad hace más de diez minutos: inactivo', () => {
    const entrada = persona({ ultimaActividadMs: AHORA - UMBRAL_INACTIVIDAD_MS });
    expect(calcularEstadoDePresencia(entrada)).toBe('inactivo');
  });

  it('persona conectada justo por debajo del umbral: en-la-sala', () => {
    const entrada = persona({ ultimaActividadMs: AHORA - UMBRAL_INACTIVIDAD_MS + 1 });
    expect(calcularEstadoDePresencia(entrada)).toBe('en-la-sala');
  });

  it('persona sin conexión: anadido, aunque tenga actividad reciente', () => {
    expect(calcularEstadoDePresencia(persona({ conectada: false }))).toBe('anadido');
  });

  it('persona escribiendo: gana a en-la-sala y a inactivo', () => {
    const activa = persona({ escribiendoHastaMs: AHORA + DURACION_ESCRIBIENDO_MS });
    expect(calcularEstadoDePresencia(activa)).toBe('escribiendo');
    const inactiva = persona({
      ultimaActividadMs: AHORA - UMBRAL_INACTIVIDAD_MS,
      escribiendoHastaMs: AHORA + DURACION_ESCRIBIENDO_MS,
    });
    expect(calcularEstadoDePresencia(inactiva)).toBe('escribiendo');
  });

  it('escribiendo caducado no cuenta: vuelve al estado que toque', () => {
    const entrada = persona({ escribiendoHastaMs: AHORA - 1 });
    expect(calcularEstadoDePresencia(entrada)).toBe('en-la-sala');
  });

  it('agente pausado: en-pausa, aunque tenga tarea en curso', () => {
    const entrada = agente({ estadoPuesto: 'pausado', tareaEnCurso: true });
    expect(calcularEstadoDePresencia(entrada)).toBe('en-pausa');
  });

  it('agente con aprobación pendiente: te-necesita, aunque tenga tarea en curso', () => {
    const entrada = agente({ aprobacionPendiente: true, tareaEnCurso: true });
    expect(calcularEstadoDePresencia(entrada)).toBe('te-necesita');
  });

  it('agente con tarea en curso y sin aprobación pendiente: trabajando', () => {
    expect(calcularEstadoDePresencia(agente({ tareaEnCurso: true }))).toBe('trabajando');
  });

  it('agente propuesto, sin trabajo: anadido', () => {
    expect(calcularEstadoDePresencia(agente({ estadoPuesto: 'propuesto' }))).toBe('anadido');
  });

  it('agente degradado, sin trabajo: inactivo', () => {
    expect(calcularEstadoDePresencia(agente({ estadoPuesto: 'degradado' }))).toBe('inactivo');
  });

  it('agente activo o en prueba, sin trabajo pendiente: en-la-sala', () => {
    expect(calcularEstadoDePresencia(agente({ estadoPuesto: 'activo' }))).toBe('en-la-sala');
    expect(calcularEstadoDePresencia(agente({ estadoPuesto: 'en_prueba' }))).toBe('en-la-sala');
  });

  it('agente escribiendo: gana a trabajar y a en-pausa', () => {
    const entrada = agente({
      estadoPuesto: 'pausado',
      escribiendoHastaMs: AHORA + DURACION_ESCRIBIENDO_MS,
    });
    expect(calcularEstadoDePresencia(entrada)).toBe('escribiendo');
  });
});
