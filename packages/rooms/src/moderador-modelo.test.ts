import { describe, expect, it, vi } from 'vitest';

import type {
  PeticionDeClasificacion,
  PuertoDeClasificacion,
  RespuestaDeClasificacion,
} from './clasificacion';
import { INTENTOS_DE_CLASIFICACION } from './clasificacion';
import { PROMPT_DEL_MODERADOR, moderarConModelo } from './moderador-modelo';
import type { ParticipanteDeSala } from './moderador';

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
  temas: ['concilia', 'banco'],
};
const PREVISION: ParticipanteDeSala = {
  puestoId: 'p-prevision',
  nombre: 'Previsión de tesorería',
  estado: 'pausado',
  temas: ['tesoreria'],
};
const SALA = [COBROS, CONCILIACION, PREVISION];
// Sin ninguno de los temas de las fichas ni de las expresiones de contratar.
const PARAFRASIS = 'quién nos debe dinero desde hace más de dos meses';

function puertoQueResponde(salida: unknown, costeEuros = 0.0012) {
  return vi.fn((_peticion: PeticionDeClasificacion<unknown>): Promise<RespuestaDeClasificacion> =>
    Promise.resolve({ salida, costeEuros, modelo: 'prueba' }),
  ) as unknown as PuertoDeClasificacion & ReturnType<typeof vi.fn>;
}

describe('moderarConModelo · sala de un departamento', () => {
  it('una paráfrasis que las reglas dejarían en silencio da la palabra al puesto de la sala', async () => {
    const puerto = puertoQueResponde({
      puestoIds: ['p-cobros'],
      pideOperacion: false,
      motivo: 'Pregunta por impagados.',
    });
    const { decision, pasoDeModelo } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('intervenir');
    if (decision.tipo !== 'intervenir') return;
    expect(decision.turnos.map((t) => t.puestoId)).toEqual(['p-cobros']);
    expect(decision.turnos[0]?.motivo).toContain('Paso de modelo');
    expect(pasoDeModelo).toMatchObject({
      usado: true,
      resultado: 'intervenir',
      costeEuros: 0.0012,
      llamadas: 1,
      version: PROMPT_DEL_MODERADOR.version,
    });
  });

  it('solo ofrece al modelo los puestos que pueden hablar, con el prompt versionado', async () => {
    const puerto = puertoQueResponde({ puestoIds: [], pideOperacion: false, motivo: 'Nadie.' });
    await moderarConModelo(PARAFRASIS, SALA, { ambito: 'departamento', clasificador: puerto });
    const peticion = puerto.mock.calls[0]?.[0] as PeticionDeClasificacion<unknown>;
    expect(peticion.sistema).toBe(PROMPT_DEL_MODERADOR.sistema);
    const enviado = JSON.parse(peticion.usuario) as {
      mensaje: string;
      puestos: { puestoId: string }[];
    };
    expect(enviado.mensaje).toBe(PARAFRASIS);
    expect(enviado.puestos.map((p) => p.puestoId)).toEqual(['p-cobros', 'p-conciliacion']);
  });

  it('si el modelo no da la palabra a nadie, el silencio sigue siendo la respuesta', async () => {
    const puerto = puertoQueResponde({
      puestoIds: [],
      pideOperacion: false,
      motivo: 'Es charla de oficina.',
    });
    const { decision, pasoDeModelo } = await moderarConModelo('¿quién trae el café?', SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('silencio');
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'silencio' });
  });

  it('una petición de organización con otras palabras pasa al Director', async () => {
    const puerto = puertoQueResponde({
      puestoIds: [],
      pideOperacion: true,
      motivo: 'Pide un puesto.',
    });
    const { decision, pasoDeModelo } = await moderarConModelo(
      'necesitamos que alguien concilie los bancos',
      [COBROS],
      { ambito: 'departamento', clasificador: puerto },
    );
    expect(decision).toMatchObject({ tipo: 'operacion', operacion: 'contratar' });
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'operacion' });
  });

  it('nunca pasa del límite por mensaje, aunque el modelo nombre a dos', async () => {
    const puerto = puertoQueResponde({
      puestoIds: ['p-cobros', 'p-conciliacion'],
      pideOperacion: false,
      motivo: 'Los dos.',
    });
    const { decision } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo === 'intervenir' && decision.turnos.length).toBe(1);
    const dos = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
      limite: 2,
    });
    expect(dos.decision.tipo === 'intervenir' && dos.decision.turnos.length).toBe(2);
  });
});

describe('moderarConModelo · límite de intervenciones', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -3])(
    'un límite no válido (%s) vale el de por defecto y no vacía la intervención',
    async (limite) => {
      const puerto = puertoQueResponde({
        puestoIds: ['p-cobros', 'p-conciliacion'],
        pideOperacion: false,
        motivo: 'Los dos.',
      });
      const { decision } = await moderarConModelo(PARAFRASIS, SALA, {
        ambito: 'departamento',
        clasificador: puerto,
        limite,
      });
      expect(decision.tipo === 'intervenir' && decision.turnos.length).toBe(1);
    },
  );
});

describe('moderarConModelo · el modelo solo elige de la lista', () => {
  it.each([
    ['un puestoId inventado', ['p-inventado']],
    ['un puesto pausado que no estaba en la lista', ['p-prevision']],
  ])('%s es un fallo de esquema, no una intervención', async (_nombre, puestoIds) => {
    const puerto = puertoQueResponde({ puestoIds, pideOperacion: false, motivo: 'Eso.' });
    const { decision, pasoDeModelo } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('silencio');
    expect(pasoDeModelo).toMatchObject({ usado: true, resultado: 'no_disponible' });
    // Se reintenta dentro del límite y se suma el coste de cada llamada hecha.
    expect(puerto).toHaveBeenCalledTimes(INTENTOS_DE_CLASIFICACION);
    expect(pasoDeModelo.usado && pasoDeModelo.costeEuros).toBeCloseTo(0.0024, 6);
    expect(pasoDeModelo.usado && pasoDeModelo.motivo).toContain('esquema');
  });

  it('más de dos puestos o una salida que no es el esquema también se rechazan', async () => {
    for (const salida of [
      { puestoIds: ['p-cobros', 'p-conciliacion', 'p-cobros'], pideOperacion: false, motivo: 'x' },
      'texto libre del modelo',
      { puestoIds: ['p-cobros'], motivo: 'sin pideOperacion' },
    ]) {
      const { decision } = await moderarConModelo(PARAFRASIS, SALA, {
        ambito: 'departamento',
        clasificador: puertoQueResponde(salida),
      });
      expect(decision.tipo).toBe('silencio');
    }
  });
});

describe('moderarConModelo · resiliencia y alcance', () => {
  it('un fallo del modelo deja el silencio de las reglas y dice que el paso no estuvo disponible', async () => {
    const puerto = vi.fn(() =>
      Promise.reject(new Error('tiempo agotado')),
    ) as unknown as PuertoDeClasificacion;
    const { decision, pasoDeModelo } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('silencio');
    expect(decision.motivo).toContain('no estuvo disponible');
    expect(pasoDeModelo).toMatchObject({
      usado: true,
      resultado: 'no_disponible',
      costeEuros: 0,
      llamadas: 0,
    });
  });

  it('un reintento tras un fallo puede acertar', async () => {
    const buena = { puestoIds: ['p-cobros'], pideOperacion: false, motivo: 'Impagados.' };
    const puerto = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce({
      salida: buena,
      costeEuros: 0.001,
      modelo: 'prueba',
    }) as unknown as PuertoDeClasificacion;
    const { decision } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('intervenir');
  });

  it('la sala general nunca llama al modelo: silencio y coste cero como en v0', async () => {
    const puerto = puertoQueResponde({
      puestoIds: ['p-cobros'],
      pideOperacion: false,
      motivo: 'x',
    });
    const { decision, pasoDeModelo } = await moderarConModelo(PARAFRASIS, SALA, {
      ambito: 'organizacion',
      clasificador: puerto,
    });
    expect(decision.tipo).toBe('silencio');
    expect(pasoDeModelo).toEqual({ usado: false, razon: 'sala_general' });
    expect(puerto).not.toHaveBeenCalled();
  });

  it('si las reglas deciden —tema, mención o contratar— no se gasta modelo', async () => {
    const puerto = puertoQueResponde({ puestoIds: [], pideOperacion: false, motivo: 'x' });
    for (const texto of ['¿cómo vamos de cobros?', '@Cobros ¿estás?', 'contrata un agente']) {
      const { pasoDeModelo } = await moderarConModelo(texto, SALA, {
        ambito: 'departamento',
        clasificador: puerto,
      });
      expect(pasoDeModelo).toEqual({ usado: false, razon: 'reglas_decidieron' });
    }
    expect(puerto).not.toHaveBeenCalled();
  });

  it('sin agentes que puedan hablar, o sin puerto, no hay paso de modelo', async () => {
    const puerto = puertoQueResponde({ puestoIds: [], pideOperacion: false, motivo: 'x' });
    const vacia = await moderarConModelo(PARAFRASIS, [PREVISION], {
      ambito: 'departamento',
      clasificador: puerto,
    });
    expect(vacia.pasoDeModelo).toEqual({ usado: false, razon: 'sin_agentes' });
    const sinPuerto = await moderarConModelo(PARAFRASIS, SALA, { ambito: 'departamento' });
    expect(sinPuerto.pasoDeModelo).toEqual({ usado: false, razon: 'sin_puerto' });
    expect(puerto).not.toHaveBeenCalled();
  });

  it('el prompt es dato versionado y no lleva credenciales', () => {
    expect(PROMPT_DEL_MODERADOR.version).toBeGreaterThan(0);
    expect(PROMPT_DEL_MODERADOR.sistema).toMatch(/puestoId de la lista/);
    expect(PROMPT_DEL_MODERADOR.sistema).not.toMatch(/sk-|AKIA|token|secret|password/i);
  });
});
