import { describe, expect, it } from 'vitest';

import {
  LARGO_MAXIMO_DEL_ENCARGO,
  idDeMensajeDelSupervisor,
  supervisarDelegacion,
  type EventoDeDelegacion,
} from './supervisor.js';

const DELEGACION = '01a0fd61-c6df-7bb2-8199-885542e4fc6b';

function evento(parcial: Partial<EventoDeDelegacion> = {}): EventoDeDelegacion {
  return {
    tipo: 'delegacion.vencida',
    delegacionId: DELEGACION,
    encargo: 'Concilia la factura F-2026-0001 con el extracto bancario y propón el asiento.',
    origen: { id: 'p-cobros', nombre: 'Cobros' },
    destino: { id: 'p-conciliacion', nombre: 'Conciliación' },
    politicaRespaldo: 'aparcar',
    ...parcial,
  };
}

describe('supervisor de departamento · reglas', () => {
  it('un plazo vencido produce un mensaje con el encargo, los dos puestos, el motivo y el siguiente paso', () => {
    const mensaje = supervisarDelegacion(evento());
    expect(mensaje).not.toBeNull();
    expect(mensaje?.motivo).toBe('plazo_vencido');
    expect(mensaje?.texto).toContain('Cobros → Conciliación');
    expect(mensaje?.texto).toContain('Concilia la factura F-2026-0001');
    expect(mensaje?.texto).toContain('no respondió dentro del plazo');
    expect(mensaje?.texto).toContain('Siguiente paso propuesto:');
    expect(mensaje?.propuesta).toContain('aparcada');
  });

  it('el respaldo aplicado produce el mismo mensaje con su propio motivo', () => {
    const mensaje = supervisarDelegacion(evento({ tipo: 'delegacion.respaldo_aplicado' }));
    expect(mensaje?.motivo).toBe('respaldo_aplicado');
    expect(mensaje?.texto).toContain('Cobros → Conciliación');
    expect(mensaje?.texto).toContain('aplicó el respaldo del contrato: aparcar la tarea');
  });

  it('cada política de respaldo propone un siguiente paso distinto', () => {
    const pasos = (['seguir_sin_ello', 'aparcar', 'escalar_a_persona'] as const).map(
      (politicaRespaldo) => supervisarDelegacion(evento({ politicaRespaldo }))?.propuesta,
    );
    expect(new Set(pasos).size).toBe(3);
  });

  it('un destino que devuelve un resultado que escala produce un mensaje', () => {
    const mensaje = supervisarDelegacion(
      evento({ tipo: 'delegacion.cerrada', entregado: false, politicaRespaldo: undefined }),
    );
    expect(mensaje?.motivo).toBe('resultado_escala');
    expect(mensaje?.texto).toContain('escala a una persona');
  });

  it('una delegación que se cierra a tiempo y entregada no produce mensaje', () => {
    expect(
      supervisarDelegacion(evento({ tipo: 'delegacion.cerrada', entregado: true })),
    ).toBeNull();
    // Sin dato de entrega tampoco se inventa un aviso.
    expect(supervisarDelegacion(evento({ tipo: 'delegacion.cerrada' }))).toBeNull();
  });

  it('dos eventos de la misma delegación dan el mismo identificador de mensaje', () => {
    const vencida = supervisarDelegacion(evento());
    const respaldo = supervisarDelegacion(evento({ tipo: 'delegacion.respaldo_aplicado' }));
    expect(vencida?.mensajeId).toBe(respaldo?.mensajeId);
    expect(vencida?.mensajeId).toBe(idDeMensajeDelSupervisor(DELEGACION));
    expect(vencida?.mensajeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Otra delegación, otro mensaje.
    expect(idDeMensajeDelSupervisor('otra-delegacion')).not.toBe(vencida?.mensajeId);
  });

  it('el texto cita datos y no datos personales: quita correos, teléfonos e IBAN del encargo', () => {
    const mensaje = supervisarDelegacion(
      evento({
        encargo:
          'Escribe a marta.garcia@cliente-demo.es o llama al 612 345 678 por la factura F-2026-0001 (IBAN ES91 2100 0418 4502 0005 1332).',
      }),
    );
    expect(mensaje?.texto).toContain('F-2026-0001');
    expect(mensaje?.texto).not.toMatch(/@|612 345 678|ES91/);
    expect(mensaje?.texto).toContain('[dato personal]');
  });

  it('recorta un encargo largo y colapsa los saltos de línea', () => {
    const mensaje = supervisarDelegacion(evento({ encargo: `uno\n\n${'a'.repeat(500)}` }));
    const linea = mensaje?.texto.split('\n').find((l) => l.startsWith('Encargo:')) ?? '';
    expect(linea.length).toBeLessThanOrEqual(LARGO_MAXIMO_DEL_ENCARGO + 'Encargo: «».'.length);
    expect(linea).toContain('…');
  });

  it('no ejecuta nada: devuelve solo datos serializables, sin funciones ni herramientas', () => {
    const mensaje = supervisarDelegacion(evento());
    expect(JSON.parse(JSON.stringify(mensaje))).toEqual(mensaje);
    expect(Object.values(mensaje ?? {}).every((v) => typeof v === 'string')).toBe(true);
  });

  it('rechaza un evento mal formado o un respaldo sin política', () => {
    expect(() => supervisarDelegacion({ tipo: 'delegacion.vencida' })).toThrow();
    expect(() => supervisarDelegacion(evento({ tipo: 'otra.cosa' as never }))).toThrow();
    expect(() =>
      supervisarDelegacion(
        evento({ tipo: 'delegacion.respaldo_aplicado', politicaRespaldo: undefined }),
      ),
    ).toThrow(/política de respaldo/);
  });
});
