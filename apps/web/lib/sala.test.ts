import { describe, expect, it } from 'vitest';

import {
  configuracionSala,
  esNotaDelModerador,
  etiquetaDeAutor,
  llamarSala,
  propuestaDelMensaje,
  salaActiva,
  type MensajeDeLaSala,
} from './sala';

const COOKIE = 'aiw.session_token=de-la-prueba';
const ENTORNO = {
  AIW_SALA_V0: '1',
  AIW_API_URL: 'http://api.local/',
  AIW_SALA_TOKEN: crypto.randomUUID(),
};

function mensaje(parcial: Partial<MensajeDeLaSala>): MensajeDeLaSala {
  return {
    id: 'm',
    cuerpo: 'hola',
    autor: { tipo: 'persona', nombre: 'Jesús' },
    adjuntos: [],
    creadoEn: new Date(0).toISOString(),
    ...parcial,
  };
}

describe('sala en el panel', () => {
  it('sin bandera o sin configuración completa no hay sala', () => {
    expect(salaActiva({})).toBe(false);
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_V0: '0' })).toBeUndefined();
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_TOKEN: ' ' })).toBeUndefined();
    // El tenant y la persona de entorno ya no existen: aunque estén, no se usan.
    expect(configuracionSala({ ...ENTORNO, AIW_SALA_TENANT: 'x' })).toEqual({
      apiUrl: 'http://api.local',
      token: ENTORNO.AIW_SALA_TOKEN,
    });
    expect(configuracionSala(ENTORNO)?.apiUrl).toBe('http://api.local');
  });

  it('pone el token y la cookie de sesión en el servidor, y ningún tenant ni persona', async () => {
    const configuracion = configuracionSala(ENTORNO);
    if (!configuracion) throw new Error('falta configuración');
    let vista: { url: string; headers: Record<string, string>; body?: string } | undefined;
    const respuesta = await llamarSala(
      configuracion,
      'POST',
      '/sala/mensajes',
      (url, opciones) => {
        vista = {
          url,
          headers: opciones.headers,
          ...(opciones.body ? { body: opciones.body } : {}),
        };
        return Promise.resolve(new Response(JSON.stringify({ mensajeId: 'x' }), { status: 202 }));
      },
      COOKIE,
      { texto: 'hola' },
    );
    expect(respuesta).toEqual({ estado: 202, cuerpo: { mensajeId: 'x' } });
    expect(vista?.url).toBe('http://api.local/sala/mensajes');
    expect(vista?.headers['cookie']).toBe(COOKIE);
    expect(vista?.headers['x-aiw-persona']).toBeUndefined();
    expect(vista?.headers['x-aiw-tenant']).toBeUndefined();
    expect(vista?.headers['authorization']).toBe(`Bearer ${ENTORNO.AIW_SALA_TOKEN}`);
    expect(vista?.body).toBe('{"texto":"hola"}');
  });

  it('una API caída no filtra su dirección', async () => {
    const configuracion = configuracionSala(ENTORNO);
    if (!configuracion) throw new Error('falta configuración');
    const respuesta = await llamarSala(
      configuracion,
      'GET',
      '/sala',
      () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.7:3002')),
      COOKIE,
    );
    expect(respuesta.estado).toBe(502);
    expect(JSON.stringify(respuesta.cuerpo)).not.toContain('10.0.0.7');
  });

  it('pliega al moderador, firma a cada autor y encuentra la tarjeta de la propuesta', () => {
    const nota = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Moderador' },
      adjuntos: [{ tipo: 'moderacion', decision: 'intervenir' }],
    });
    expect(esNotaDelModerador(nota)).toBe(true);
    expect(etiquetaDeAutor(nota)).toBe('Moderador · plataforma');
    expect(etiquetaDeAutor(mensaje({ autor: { tipo: 'puesto', nombre: 'Cobros' } }))).toBe(
      'Cobros · agente',
    );
    const tarjeta = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Director de IA' },
      adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: 'p1' }],
    });
    const propuesta = {
      id: 'p1',
      resumen: 'r',
      estado: 'pendiente',
      nivelExigido: 'n1',
      costeEstimadoEuros: 50,
      efectos: {},
    };
    expect(propuestaDelMensaje(tarjeta, [propuesta])).toBe(propuesta);
    // La presentación del agente contratado cita la propuesta, pero no lleva la tarjeta.
    expect(
      propuestaDelMensaje({ ...tarjeta, autor: { tipo: 'puesto', nombre: 'Conciliación' } }, [
        propuesta,
      ]),
    ).toBeUndefined();
  });
});

describe('detalles de chat', () => {
  it('iniciales, hora y «respondiendo»', async () => {
    const { iniciales, horaCorta, esperandoRespuesta } = await import('./sala');
    expect(iniciales('Conciliación bancaria')).toBe('C');
    expect(iniciales('Director de IA')).toBe('DI');
    expect(iniciales('Jesús')).toBe('J');
    expect(horaCorta('no es fecha')).toBe('');
    expect(horaCorta('2026-09-24T13:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
    const persona = mensaje({});
    const nota = mensaje({
      autor: { tipo: 'plataforma', nombre: 'Moderador' },
      adjuntos: [{ tipo: 'moderacion' }],
    });
    const agente = mensaje({ autor: { tipo: 'puesto', nombre: 'Cobros' } });
    expect(esperandoRespuesta([persona, nota])).toBe(true);
    expect(esperandoRespuesta([persona, nota, agente])).toBe(false);
    expect(esperandoRespuesta([])).toBe(false);
  });
});
