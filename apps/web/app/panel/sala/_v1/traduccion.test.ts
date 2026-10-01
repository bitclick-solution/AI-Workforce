import { describe, expect, it } from 'vitest';

import type { MensajeDeSala, PropuestaDeSala } from '../../../../lib/sala-contrato';
import { aMensajesVisibles, datosDePropuesta, horaCorta } from './traduccion';

function mensaje(parcial: Partial<MensajeDeSala>): MensajeDeSala {
  return {
    id: 'm1',
    cuerpo: 'hola',
    autor: { tipo: 'persona', nombre: 'Lucía Ferrán' },
    adjuntos: [],
    creadoEn: '2026-09-28T09:02:00.000Z',
    ...parcial,
  };
}

function propuesta(parcial: Partial<PropuestaDeSala>): PropuestaDeSala {
  return {
    id: 'p1',
    resumen: 'Contratar Previsión de tesorería',
    estado: 'pendiente',
    nivelExigido: 'n1',
    costeEstimadoEuros: 50,
    efectos: {},
    ...parcial,
  };
}

describe('horaCorta', () => {
  it('da una hora corta y nada con una fecha rota', () => {
    expect(horaCorta('2026-09-28T09:02:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    expect(horaCorta('no es una fecha')).toBe('');
  });
});

describe('aMensajesVisibles', () => {
  it('un mensaje sin adjuntos es texto, con el autor y la hora traducidos', () => {
    const [visible] = aMensajesVisibles([mensaje({})], []);
    expect(visible).toMatchObject({
      tipo: 'texto',
      texto: 'hola',
      autor: { nombre: 'Lucía Ferrán', tipo: 'persona' },
    });
  });

  it('un puesto o la plataforma se traducen como agente', () => {
    const [puesto] = aMensajesVisibles(
      [mensaje({ autor: { tipo: 'puesto', nombre: 'Cobros' } })],
      [],
    );
    const [plataforma] = aMensajesVisibles(
      [mensaje({ id: 'm2', autor: { tipo: 'plataforma', nombre: 'Director de IA' } })],
      [],
    );
    expect(puesto).toMatchObject({ autor: { tipo: 'agente', nombre: 'Cobros' } });
    expect(plataforma).toMatchObject({ autor: { tipo: 'agente', nombre: 'Director de IA' } });
  });

  it('el adjunto moderacion pliega el mensaje como nota, sin autor', () => {
    const [visible] = aMensajesVisibles(
      [
        mensaje({
          autor: { tipo: 'plataforma', nombre: 'Moderador' },
          adjuntos: [{ tipo: 'moderacion', decision: 'intervenir' }],
          cuerpo: 'Le pasa la palabra a Cobros.',
        }),
      ],
      [],
    );
    expect(visible).toEqual({
      tipo: 'nota',
      id: 'm1',
      hora: expect.any(String),
      texto: 'Le pasa la palabra a Cobros.',
    });
  });

  it('el adjunto aprobacion se traduce con título, resumen y porqué', () => {
    const [visible] = aMensajesVisibles(
      [
        mensaje({
          autor: { tipo: 'puesto', nombre: 'Cobros' },
          adjuntos: [
            {
              tipo: 'aprobacion',
              titulo: 'Recordatorio a 9 clientes',
              resumen: 'Comunicar con terceros · N1',
              porque: 'Primer recordatorio.',
            },
          ],
        }),
      ],
      [],
    );
    expect(visible).toMatchObject({
      tipo: 'aprobacion',
      titulo: 'Recordatorio a 9 clientes',
      resumen: 'Comunicar con terceros · N1',
      porque: 'Primer recordatorio.',
    });
  });

  it('el adjunto propuesta_operacion enlaza con su propuesta y trae sus datos', () => {
    const p = propuesta({
      efectos: {
        puesto: { nombre: 'Previsión de tesorería' },
        coste: { tareasMes: 20, eurosMesCliente: 50, eurosMesModelo: 4 },
        herramientas: { disponibles: [{ nombre: 'erp.saldos', descripcion: 'x' }] },
      },
    });
    const [visible] = aMensajesVisibles(
      [
        mensaje({
          autor: { tipo: 'plataforma', nombre: 'Director de IA' },
          adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: 'p1' }],
        }),
      ],
      [p],
    );
    expect(visible).toMatchObject({
      tipo: 'propuesta',
      titulo: 'Previsión de tesorería',
      propuestaId: 'p1',
      estado: 'pendiente',
    });
    if (visible?.tipo === 'propuesta') {
      expect(visible.resuelta).toBeUndefined();
      expect(visible.datos).toEqual(
        expect.arrayContaining([
          { etiqueta: 'Nivel', valor: 'N1' },
          { etiqueta: 'Coste', valor: '50 € al mes · unas 20 tareas' },
          { etiqueta: 'Herramientas', valor: 'erp.saldos' },
        ]),
      );
    }
  });

  it('una propuesta ya decidida trae el texto resuelto legible', () => {
    const [aprobada] = aMensajesVisibles(
      [mensaje({ adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: 'p1' }] })],
      [propuesta({ estado: 'ejecutada' })],
    );
    if (aprobada?.tipo !== 'propuesta') throw new Error('debía ser una propuesta');
    expect(aprobada.resuelta).toBe('Contratado');
  });

  it('un propuestaId que no encuentra propuesta cae a texto, no rompe', () => {
    const [visible] = aMensajesVisibles(
      [mensaje({ adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: 'no-existe' }] })],
      [],
    );
    expect(visible?.tipo).toBe('texto');
  });
});

describe('datosDePropuesta', () => {
  it('usa costeEstimadoEuros cuando la propuesta no trae efectos.coste', () => {
    const datos = datosDePropuesta(propuesta({ costeEstimadoEuros: 75, efectos: {} }));
    expect(datos).toContainEqual({ etiqueta: 'Coste', valor: '75 € al mes' });
  });

  it('añade por conectar y cómo se deshace cuando llegan', () => {
    const datos = datosDePropuesta(
      propuesta({
        efectos: {
          herramientas: { porConectar: [{ nombre: 'banco.pagos', descripcion: 'x' }] },
          reversion: { descripcion: 'se deshace despidiéndolo desde Equipo' },
        },
      }),
    );
    expect(datos).toContainEqual({ etiqueta: 'Herramientas', valor: 'banco.pagos · por conectar' });
    expect(datos).toContainEqual({
      etiqueta: 'Se deshace',
      valor: 'se deshace despidiéndolo desde Equipo',
    });
  });
});
