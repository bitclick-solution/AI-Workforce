import { describe, expect, it } from 'vitest';

import {
  FRACCION_AVISO,
  decidirPaso,
  evaluarPresupuesto,
  type ContextoPolitica,
  type PasoPropuesto,
} from './politicas.js';
import { esquemas } from './index.js';

function politica(
  niveles: Record<string, 'n0' | 'n1' | 'n2' | 'n3'>,
  clasesProhibidas: string[] = [],
) {
  return esquemas.politicaPuesto.parse({ niveles, clasesProhibidas });
}

function contexto(parcial: Partial<ContextoPolitica> = {}): ContextoPolitica {
  return {
    estadoPuesto: 'activo',
    politica: politica({ lectura: 'n3', escritura: 'n1' }),
    presupuesto: { limiteEuros: 10, gastadoEuros: 0 },
    ...parcial,
  };
}

const lectura: PasoPropuesto = { claseAccion: 'lectura', tipo: 'lectura' };
const escritura: PasoPropuesto = { claseAccion: 'escritura', tipo: 'escritura' };

describe('motor mínimo de políticas · tabla clase × nivel × estado', () => {
  it('lectura N3 con el puesto activo ejecuta', () => {
    const veredicto = decidirPaso(lectura, contexto());
    expect(veredicto.decision).toBe('ejecutar');
    expect(veredicto.nivelAplicado).toBe('n3');
  });

  it('escritura N1 con el puesto activo pide aprobación y ejecuta después', () => {
    const veredicto = decidirPaso(escritura, contexto());
    expect(veredicto.decision).toBe('pedir_aprobacion');
    expect(veredicto.nivelAplicado).toBe('n1');
    expect(veredicto.ejecutaTrasAprobacion).toBe(true);
  });

  it('N0 pide aprobación pero no ejecuta: es manual', () => {
    const veredicto = decidirPaso(escritura, contexto({ politica: politica({ escritura: 'n0' }) }));
    expect(veredicto.decision).toBe('pedir_aprobacion');
    expect(veredicto.ejecutaTrasAprobacion).toBe(false);
  });

  it('N2 ejecuta sin pedir permiso', () => {
    const veredicto = decidirPaso(escritura, contexto({ politica: politica({ escritura: 'n2' }) }));
    expect(veredicto.decision).toBe('ejecutar');
    expect(veredicto.nivelAplicado).toBe('n2');
  });

  it('un puesto en prueba simula la escritura aunque su nivel fuera N3', () => {
    const veredicto = decidirPaso(
      escritura,
      contexto({ estadoPuesto: 'en_prueba', politica: politica({ escritura: 'n3' }) }),
    );
    expect(veredicto.decision).toBe('simular');
    expect(veredicto.motivo).toContain('en prueba');
  });

  it('un puesto en prueba sí ejecuta lecturas', () => {
    expect(decidirPaso(lectura, contexto({ estadoPuesto: 'en_prueba' })).decision).toBe('ejecutar');
  });

  it('un puesto degradado baja la escritura N3 a N1 y pide permiso', () => {
    const veredicto = decidirPaso(
      escritura,
      contexto({ estadoPuesto: 'degradado', politica: politica({ escritura: 'n3' }) }),
    );
    expect(veredicto.decision).toBe('pedir_aprobacion');
    expect(veredicto.nivelAplicado).toBe('n1');
    expect(veredicto.motivo).toContain('degradado');
  });

  it.each(['propuesto', 'pausado', 'dado_de_baja'] as const)(
    'un puesto %s no da ningún paso',
    (estadoPuesto) => {
      const veredicto = decidirPaso(lectura, contexto({ estadoPuesto }));
      expect(veredicto.decision).toBe('rechazar');
      expect(veredicto.nivelAplicado).toBeNull();
    },
  );

  it('una clase sin nivel asignado se rechaza: el silencio no autoriza', () => {
    const veredicto = decidirPaso(
      { claseAccion: 'borrar', tipo: 'escritura' },
      contexto({ politica: politica({ lectura: 'n3' }) }),
    );
    expect(veredicto.decision).toBe('rechazar');
    expect(veredicto.motivo).toContain('borrar');
  });

  it('una clase prohibida se rechaza por delante de su nivel', () => {
    const veredicto = decidirPaso(
      escritura,
      contexto({ politica: politica({ escritura: 'n3' }, ['escritura']) }),
    );
    expect(veredicto.decision).toBe('rechazar');
    expect(veredicto.motivo).toContain('prohibida');
  });
});

describe('motor mínimo de políticas · presupuesto y parada', () => {
  it('el presupuesto agotado detiene antes de mirar nivel o estado', () => {
    const veredicto = decidirPaso(
      lectura,
      contexto({
        estadoPuesto: 'en_prueba',
        presupuesto: { limiteEuros: 5, gastadoEuros: 5 },
      }),
    );
    expect(veredicto.decision).toBe('detener');
    expect(veredicto.avisoPresupuesto).toBe(true);
  });

  it('un paso cuyo coste estimado pasa del límite detiene antes de gastarlo', () => {
    const veredicto = decidirPaso(
      { ...lectura, costeEstimadoEuros: 3 },
      contexto({ presupuesto: { limiteEuros: 4, gastadoEuros: 2 } }),
    );
    expect(veredicto.decision).toBe('detener');
  });

  it('avisa al 80 % y sigue ejecutando', () => {
    const veredicto = decidirPaso(
      lectura,
      contexto({ presupuesto: { limiteEuros: 10, gastadoEuros: 8 } }),
    );
    expect(veredicto.decision).toBe('ejecutar');
    expect(veredicto.avisoPresupuesto).toBe(true);
  });

  it('avisa en el paso que cruza el 80 %, no en el siguiente', () => {
    const cruza = evaluarPresupuesto({ limiteEuros: 10, gastadoEuros: 7 }, 1.5);
    expect(cruza.avisar).toBe(true);
    expect(cruza.agotado).toBe(false);
    expect(evaluarPresupuesto({ limiteEuros: 10, gastadoEuros: 7 }, 0.5).avisar).toBe(false);
  });

  it('un límite de cero euros significa que esta tarea no gasta', () => {
    expect(evaluarPresupuesto({ limiteEuros: 0, gastadoEuros: 0 }).agotado).toBe(true);
  });

  it('sin límite declarado no se detiene ni se avisa', () => {
    const estado = evaluarPresupuesto({ limiteEuros: null, gastadoEuros: 1000 }, 500);
    expect(estado.agotado).toBe(false);
    expect(estado.avisar).toBe(false);
  });

  it('la fracción de aviso es la del ADR-003', () => {
    expect(FRACCION_AVISO).toBe(0.8);
  });
});
