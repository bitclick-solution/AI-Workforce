import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  atenderSala,
  configuracionSalaDesdeEntorno,
  type ConfiguracionSala,
  type PeticionSala,
  type PropuestaDeLaVista,
  type PuertoSala,
} from './sala';

const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';
const SALA = '01a0d39e-98c3-7970-814a-0a98ad132313';
const PROPUESTA = '01a0d39e-98c3-7970-814a-0a98ad132314';
// Nace con la prueba: ni de juguete se escribe una credencial en el código.
const TOKEN = randomUUID();

const CONFIGURACION: ConfiguracionSala = {
  token: TOKEN,
  temporal: { direccion: 'localhost:7233', espacio: 'default', cola: 'cola' },
};

function puertoFalso(estadoPropuesta = 'pendiente') {
  const arrancados: unknown[] = [];
  const senales: unknown[] = [];
  const propuesta: PropuestaDeLaVista = {
    id: PROPUESTA,
    resumen: 'Contratar Conciliación bancaria en Finanzas',
    estado: estadoPropuesta,
    nivelExigido: 'n1',
    costeEstimadoEuros: 50,
    efectos: {},
  };
  const puerto: PuertoSala = {
    salaGeneral: () => Promise.resolve(SALA),
    personaActiva: (_t, persona) => Promise.resolve(persona === PERSONA),
    mensajes: () =>
      Promise.resolve([
        {
          id: 'm1',
          cuerpo: 'Propongo contratar…',
          autor: { tipo: 'plataforma', nombre: 'Director de IA' },
          adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: PROPUESTA }],
          creadoEn: new Date(0).toISOString(),
        },
      ]),
    propuestas: (_t, ids) => Promise.resolve(ids.includes(PROPUESTA) ? [propuesta] : []),
    arrancarMensaje: (entrada) => {
      arrancados.push(entrada);
      return Promise.resolve();
    },
    decidirPropuesta: (id, carga) => {
      senales.push({ id, carga });
      return Promise.resolve();
    },
  };
  return { puerto, arrancados, senales };
}

function peticion(parcial: Partial<PeticionSala> = {}): PeticionSala {
  return {
    metodo: 'GET',
    url: '/sala',
    cabeceras: {
      authorization: `Bearer ${TOKEN}`,
      'x-aiw-tenant': TENANT,
      'x-aiw-persona': PERSONA,
    },
    ...parcial,
  };
}

describe('rutas de la sala v0', () => {
  it('sin bandera o sin token la ruta no existe', async () => {
    expect(configuracionSalaDesdeEntorno({})).toBeUndefined();
    expect(configuracionSalaDesdeEntorno({ AIW_SALA_V0: '1' })).toBeUndefined();
    expect(
      configuracionSalaDesdeEntorno({ AIW_SALA_V0: '1', AIW_SALA_TOKEN: TOKEN })?.temporal.cola,
    ).toBe('aiw-prueba-stack');
    expect(await atenderSala(peticion(), undefined, puertoFalso().puerto)).toBeUndefined();
    expect(
      await atenderSala(peticion({ url: '/contador' }), CONFIGURACION, puertoFalso().puerto),
    ).toBeUndefined();
  });

  it('pide el token, las cabeceras y una persona activa', async () => {
    const { puerto } = puertoFalso();
    const sinToken = await atenderSala(
      peticion({ cabeceras: { 'x-aiw-tenant': TENANT } }),
      CONFIGURACION,
      puerto,
    );
    expect(sinToken?.estado).toBe(401);
    const sinPersona = await atenderSala(
      peticion({ cabeceras: { authorization: `Bearer ${TOKEN}`, 'x-aiw-tenant': TENANT } }),
      CONFIGURACION,
      puerto,
    );
    expect(sinPersona?.estado).toBe(400);
    const otra = await atenderSala(
      peticion({
        cabeceras: {
          authorization: `Bearer ${TOKEN}`,
          'x-aiw-tenant': TENANT,
          'x-aiw-persona': PROPUESTA,
        },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(otra?.estado).toBe(403);
  });

  it('lee la sala con sus propuestas', async () => {
    const leida = await atenderSala(peticion(), CONFIGURACION, puertoFalso().puerto);
    expect(leida?.estado).toBe(200);
    expect(leida?.cuerpo['salaId']).toBe(SALA);
    expect((leida?.cuerpo['propuestas'] as { id: string }[]).map((p) => p.id)).toEqual([PROPUESTA]);
  });

  it('escribir arranca el flujo y no escribe nada por su cuenta', async () => {
    const { puerto, arrancados } = puertoFalso();
    const escrita = await atenderSala(
      peticion({ metodo: 'POST', url: '/sala/mensajes', cuerpo: { texto: '  ¿cómo vamos?  ' } }),
      CONFIGURACION,
      puerto,
    );
    expect(escrita?.estado).toBe(202);
    expect(arrancados).toEqual([
      {
        tenantId: TENANT,
        salaId: SALA,
        personaId: PERSONA,
        mensajeId: escrita?.cuerpo['mensajeId'],
        texto: '¿cómo vamos?',
      },
    ]);
    const vacia = await atenderSala(
      peticion({ metodo: 'POST', url: '/sala/mensajes', cuerpo: { texto: ' ' } }),
      CONFIGURACION,
      puerto,
    );
    expect(vacia?.estado).toBe(400);
    const larga = await atenderSala(
      peticion({ metodo: 'POST', url: '/sala/mensajes', cuerpo: { texto: 'a'.repeat(2001) } }),
      CONFIGURACION,
      puerto,
    );
    expect(larga?.estado).toBe(413);
    expect(arrancados).toHaveLength(1);
  });

  it('el clic señala la propuesta pendiente con la persona de la cabecera', async () => {
    const { puerto, senales } = puertoFalso();
    const url = `/sala/propuestas/${PROPUESTA}/decision`;
    const decidida = await atenderSala(
      peticion({ metodo: 'POST', url, cuerpo: { sentido: 'aprobada', personaId: 'otra' } }),
      CONFIGURACION,
      puerto,
    );
    expect(decidida?.estado).toBe(202);
    expect(senales).toEqual([
      { id: PROPUESTA, carga: { personaId: PERSONA, sentido: 'aprobada' } },
    ]);
    const mal = await atenderSala(
      peticion({ metodo: 'POST', url, cuerpo: { sentido: 'quizá' } }),
      CONFIGURACION,
      puerto,
    );
    expect(mal?.estado).toBe(400);
  });

  it('una propuesta ya decidida no se vuelve a decidir', async () => {
    const { puerto, senales } = puertoFalso('ejecutada');
    const tarde = await atenderSala(
      peticion({
        metodo: 'POST',
        url: `/sala/propuestas/${PROPUESTA}/decision`,
        cuerpo: { sentido: 'rechazada' },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(tarde?.estado).toBe(409);
    expect(senales).toEqual([]);
  });
});
