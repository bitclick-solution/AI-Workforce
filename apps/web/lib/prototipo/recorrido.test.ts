import { describe, expect, it } from 'vitest';

import {
  duracionHastaAprobacion,
  estaCompleto,
  marcarEdicion,
  RECORRIDO_INICIAL,
  sellar,
  siguienteHito,
  sumarTareas,
  transcurrido,
} from './recorrido';

describe('sellar', () => {
  it('guarda la marca de tiempo del hito', () => {
    const recorrido = sellar(RECORRIDO_INICIAL, 'primerClic', 1_000);
    expect(recorrido.hitos.primerClic).toBe(1_000);
  });

  it('no mueve un hito ya sellado: repetir un paso no retrasa el reloj', () => {
    const primero = sellar(RECORRIDO_INICIAL, 'primerClic', 1_000);
    const segundo = sellar(primero, 'primerClic', 9_000);
    expect(segundo.hitos.primerClic).toBe(1_000);
    expect(segundo).toBe(primero);
  });

  it('no muta el recorrido anterior', () => {
    const recorrido = sellar(RECORRIDO_INICIAL, 'primerClic', 1_000);
    expect(RECORRIDO_INICIAL.hitos.primerClic).toBeUndefined();
    expect(recorrido).not.toBe(RECORRIDO_INICIAL);
  });
});

describe('duracionHastaAprobacion', () => {
  it('es nula mientras no haya primera tarea aprobada', () => {
    expect(duracionHastaAprobacion(RECORRIDO_INICIAL)).toBeNull();
    expect(duracionHastaAprobacion(sellar(RECORRIDO_INICIAL, 'primerClic', 1_000))).toBeNull();
  });

  it('es la diferencia entre el primer clic y la primera aprobación', () => {
    let recorrido = sellar(RECORRIDO_INICIAL, 'primerClic', 1_000);
    recorrido = sellar(recorrido, 'tareaAprobada', 1_000 + 8 * 60_000);
    expect(duracionHastaAprobacion(recorrido)).toBe(8 * 60_000);
  });

  it('es nula si falta el primer clic, aunque haya aprobación', () => {
    expect(duracionHastaAprobacion(sellar(RECORRIDO_INICIAL, 'tareaAprobada', 5_000))).toBeNull();
  });
});

describe('transcurrido', () => {
  it('es nulo antes del primer clic', () => {
    expect(transcurrido(RECORRIDO_INICIAL, 5_000)).toBeNull();
  });

  it('corre mientras no haya aprobación y se para al aprobar', () => {
    const empezado = sellar(RECORRIDO_INICIAL, 'primerClic', 1_000);
    expect(transcurrido(empezado, 4_000)).toBe(3_000);

    const aprobado = sellar(empezado, 'tareaAprobada', 4_000);
    expect(transcurrido(aprobado, 99_000)).toBe(3_000);
  });
});

describe('siguienteHito', () => {
  it('va en orden y termina en nulo', () => {
    let recorrido = RECORRIDO_INICIAL;
    expect(siguienteHito(recorrido)).toBe('primerClic');
    recorrido = sellar(recorrido, 'primerClic', 1);
    expect(siguienteHito(recorrido)).toBe('agenteContratado');
    recorrido = sellar(recorrido, 'agenteContratado', 2);
    expect(siguienteHito(recorrido)).toBe('intervencionPedida');
    recorrido = sellar(recorrido, 'intervencionPedida', 3);
    expect(siguienteHito(recorrido)).toBe('tareaAprobada');
    recorrido = sellar(recorrido, 'tareaAprobada', 4);
    expect(siguienteHito(recorrido)).toBeNull();
    expect(estaCompleto(recorrido)).toBe(true);
  });
});

describe('tareas y edición', () => {
  it('suma tareas y no admite restas', () => {
    expect(sumarTareas(RECORRIDO_INICIAL, 9).tareas).toBe(9);
    expect(sumarTareas(sumarTareas(RECORRIDO_INICIAL, 9), -4).tareas).toBe(9);
  });

  it('distingue aprobado de aprobado con edición', () => {
    expect(RECORRIDO_INICIAL.aprobadaConEdicion).toBe(false);
    expect(marcarEdicion(RECORRIDO_INICIAL).aprobadaConEdicion).toBe(true);
  });
});
