/**
 * Inicio del panel: bandera, lectura, escritura y suscripción en tiempo real.
 * Sin red: el buscador se inyecta en cada caso.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  BANDERA_INICIO,
  ErrorDelInicio,
  configuracionInicioWeb,
  decidirAviso,
  encargarTarea,
  inicioActivo,
  leerAgentes,
  leerAvisos,
  reenviarInicio,
  suscribirseAAgentesEnVivo,
} from './inicio';
import type { CambioDeSala, FuenteDeSala, MiembroDeSala, ResumenDeSala } from './sala-contrato';

describe('inicioActivo y configuracionInicioWeb', () => {
  it('apagado por defecto', () => {
    expect(inicioActivo({})).toBe(false);
    expect(configuracionInicioWeb({})).toBeUndefined();
  });

  it('activo con la bandera y la URL de la API', () => {
    expect(inicioActivo({ [BANDERA_INICIO]: '1' })).toBe(true);
    expect(configuracionInicioWeb({ [BANDERA_INICIO]: '1', AIW_API_URL: 'http://x/' })).toEqual({
      apiUrl: 'http://x',
    });
  });

  it('con la bandera pero sin AIW_API_URL, no hay configuración', () => {
    expect(configuracionInicioWeb({ [BANDERA_INICIO]: '1' })).toBeUndefined();
  });
});

describe('leerAgentes y leerAvisos', () => {
  it('leerAgentes pide /api/inicio/agentes y devuelve la lista', async () => {
    const buscar = vi.fn(
      async () => new Response(JSON.stringify({ agentes: [{ puestoId: 'p1' }] }), { status: 200 }),
    );
    const agentes = await leerAgentes(buscar);
    expect(agentes).toEqual([{ puestoId: 'p1' }]);
    expect(buscar).toHaveBeenCalledWith('/api/inicio/agentes', { cache: 'no-store' });
  });

  it('leerAvisos lanza ErrorDelInicio con el estado cuando la API falla', async () => {
    const buscar = vi.fn(
      async () => new Response(JSON.stringify({ error: 'no autorizado' }), { status: 401 }),
    );
    await expect(leerAvisos(buscar)).rejects.toMatchObject({
      estado: 401,
      message: 'no autorizado',
    });
  });

  it('ErrorDelInicio conserva el estado HTTP', () => {
    const error = new ErrorDelInicio('mensaje', 409);
    expect(error.estado).toBe(409);
  });
});

describe('encargarTarea y decidirAviso', () => {
  it('encargarTarea manda POST con el cuerpo y devuelve el id de la tarea', async () => {
    const buscar = vi.fn(
      async () => new Response(JSON.stringify({ tareaId: 't1' }), { status: 202 }),
    );
    const resultado = await encargarTarea({ puestoId: 'p1', encargo: 'Revisa esto.' }, buscar);
    expect(resultado).toEqual({ tareaId: 't1' });
    expect(buscar).toHaveBeenCalledWith(
      '/api/inicio/encargar',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ puestoId: 'p1', encargo: 'Revisa esto.' }),
      }),
    );
  });

  it('decidirAviso manda POST al aviso con el sentido', async () => {
    const buscar = vi.fn(
      async () =>
        new Response(JSON.stringify({ aprobacionId: 'a1', yaEstaba: false, sentido: 'aprobada' }), {
          status: 200,
        }),
    );
    const resultado = await decidirAviso('a1', 'aprobada', buscar);
    expect(resultado.yaEstaba).toBe(false);
    expect(buscar).toHaveBeenCalledWith(
      '/api/inicio/avisos/a1/decidir',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ sentido: 'aprobada' }) }),
    );
  });
});

function fuenteFalsa(salas: ResumenDeSala[]): FuenteDeSala & { suscripciones: string[] } {
  const suscripciones: string[] = [];
  return {
    suscripciones,
    salas: () => Promise.resolve(salas),
    miembros: (): Promise<MiembroDeSala[]> => Promise.resolve([]),
    suscribir: (salaId: string, _alCambiar: (cambio: CambioDeSala) => void) => {
      suscripciones.push(salaId);
      return () => {
        const indice = suscripciones.indexOf(salaId);
        if (indice >= 0) suscripciones.splice(indice, 1);
      };
    },
    indicarEscritura: () => undefined,
  };
}

describe('suscribirseAAgentesEnVivo', () => {
  it('se suscribe solo a las salas de equipo, no a la general', async () => {
    const fuente = fuenteFalsa([
      { id: 'general', nombre: 'General', ambito: 'general', sinLeer: 0, menciones: 0 },
      { id: 'finanzas', nombre: 'Sala de Finanzas', ambito: 'equipo', sinLeer: 0, menciones: 0 },
    ]);
    await suscribirseAAgentesEnVivo(fuente, () => undefined);
    expect(fuente.suscripciones).toEqual(['finanzas']);
  });

  it('la función devuelta da de baja todas las suscripciones', async () => {
    const fuente = fuenteFalsa([
      { id: 'a', nombre: 'A', ambito: 'equipo', sinLeer: 0, menciones: 0 },
      { id: 'b', nombre: 'B', ambito: 'equipo', sinLeer: 0, menciones: 0 },
    ]);
    const darDeBaja = await suscribirseAAgentesEnVivo(fuente, () => undefined);
    expect(fuente.suscripciones).toEqual(['a', 'b']);
    darDeBaja();
    expect(fuente.suscripciones).toEqual([]);
  });

  it('llama a alCambiar cuando la sala avisa de un cambio', async () => {
    let capturado: ((cambio: CambioDeSala) => void) | undefined;
    const fuente: FuenteDeSala = {
      salas: () =>
        Promise.resolve([{ id: 'a', nombre: 'A', ambito: 'equipo', sinLeer: 0, menciones: 0 }]),
      miembros: () => Promise.resolve([]),
      suscribir: (_salaId, alCambiar) => {
        capturado = alCambiar;
        return () => undefined;
      },
      indicarEscritura: () => undefined,
    };
    const alCambiar = vi.fn();
    await suscribirseAAgentesEnVivo(fuente, alCambiar);
    capturado?.({ tipo: 'mensaje', salaId: 'a' });
    expect(alCambiar).toHaveBeenCalledTimes(1);
  });

  it('si fuente.salas() falla, no lanza y devuelve una baja que no hace nada', async () => {
    const fuente: FuenteDeSala = {
      salas: () => Promise.reject(new Error('caída')),
      miembros: () => Promise.resolve([]),
      suscribir: () => () => undefined,
      indicarEscritura: () => undefined,
    };
    const darDeBaja = await suscribirseAAgentesEnVivo(fuente, () => undefined);
    expect(() => darDeBaja()).not.toThrow();
  });
});

describe('reenviarInicio', () => {
  it('reenvía método, ruta, cookie del acceso y cuerpo', async () => {
    const buscar = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const respuesta = await reenviarInicio(
      '/inicio/encargar',
      'POST',
      'http://api.local',
      'aiw.session_token=x; otra=cosa',
      buscar,
      { encargo: 'hola' },
    );
    expect(respuesta.status).toBe(200);
    expect(buscar).toHaveBeenCalledWith('http://api.local/inicio/encargar', {
      method: 'POST',
      headers: { cookie: 'aiw.session_token=x', 'content-type': 'application/json' },
      body: JSON.stringify({ encargo: 'hola' }),
    });
  });

  it('si la API no responde, 502 sin filtrar el motivo real', async () => {
    const buscar = vi.fn(async () => {
      throw new Error('ECONNREFUSED en http://10.0.0.9:3002');
    });
    const respuesta = await reenviarInicio(
      '/inicio/agentes',
      'GET',
      'http://api.local',
      null,
      buscar,
    );
    expect(respuesta.status).toBe(502);
    const cuerpo = (await respuesta.json()) as { error: string };
    expect(cuerpo.error).not.toContain('10.0.0.9');
  });
});
