import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
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

/** La cookie dice qué sesión es; la sesión, qué persona. Nunca las cabeceras. */
const SESIONES: Record<string, string> = {
  'aiw.session_token=valida': PERSONA,
  'aiw.session_token=de-otra-persona': PROPUESTA,
};

const sesiones: ResolutorDeSesion = (cabeceras) => {
  const personaId = SESIONES[String(cabeceras['cookie'])];
  return Promise.resolve(
    personaId
      ? {
          sesionId: '01a0d39e-98c3-7970-814a-0a98ad132399',
          usuarioId: '01a0d39e-98c3-7970-814a-0a98ad132398',
          tenantId: TENANT,
          personaId,
          nombre: 'Propietaria',
          correo: 'propietaria@ejemplo.local',
          caducaEn: new Date(Date.now() + 3_600_000),
        }
      : null,
  );
};

function atender(
  peticionSala: PeticionSala,
  configuracion: ConfiguracionSala | undefined,
  puerto: PuertoSala,
) {
  return atenderSala(peticionSala, configuracion, puerto, sesiones);
}

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
      cookie: 'aiw.session_token=valida',
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

  it('pide el token, una sesión y una persona activa', async () => {
    const { puerto } = puertoFalso();
    const sinToken = await atender(
      peticion({ cabeceras: { cookie: 'aiw.session_token=valida' } }),
      CONFIGURACION,
      puerto,
    );
    expect(sinToken?.estado).toBe(401);
    // Las cabeceras de tenant y persona de antes ya no abren nada.
    const sinSesion = await atender(
      peticion({
        cabeceras: {
          authorization: `Bearer ${TOKEN}`,
          'x-aiw-tenant': TENANT,
          'x-aiw-persona': PERSONA,
        },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(sinSesion?.estado).toBe(401);
    // Sin acceso configurado, nadie tiene sesión.
    expect((await atenderSala(peticion(), CONFIGURACION, puerto))?.estado).toBe(401);
    const otra = await atender(
      peticion({
        cabeceras: {
          authorization: `Bearer ${TOKEN}`,
          cookie: 'aiw.session_token=de-otra-persona',
        },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(otra?.estado).toBe(403);
  });

  it('la persona es la de la sesión aunque la cabecera diga otra', async () => {
    const { puerto, arrancados } = puertoFalso();
    const escrita = await atender(
      peticion({
        metodo: 'POST',
        url: '/sala/mensajes',
        cuerpo: { texto: 'hola' },
        cabeceras: {
          authorization: `Bearer ${TOKEN}`,
          cookie: 'aiw.session_token=valida',
          'x-aiw-persona': PROPUESTA,
        },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(escrita?.estado).toBe(202);
    expect(arrancados).toMatchObject([{ personaId: PERSONA, tenantId: TENANT }]);
  });

  it('lee la sala con sus propuestas', async () => {
    const leida = await atender(peticion(), CONFIGURACION, puertoFalso().puerto);
    expect(leida?.estado).toBe(200);
    expect(leida?.cuerpo['salaId']).toBe(SALA);
    expect((leida?.cuerpo['propuestas'] as { id: string }[]).map((p) => p.id)).toEqual([PROPUESTA]);
  });

  it('escribir arranca el flujo y no escribe nada por su cuenta', async () => {
    const { puerto, arrancados } = puertoFalso();
    const escrita = await atender(
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
    const vacia = await atender(
      peticion({ metodo: 'POST', url: '/sala/mensajes', cuerpo: { texto: ' ' } }),
      CONFIGURACION,
      puerto,
    );
    expect(vacia?.estado).toBe(400);
    const larga = await atender(
      peticion({ metodo: 'POST', url: '/sala/mensajes', cuerpo: { texto: 'a'.repeat(2001) } }),
      CONFIGURACION,
      puerto,
    );
    expect(larga?.estado).toBe(413);
    expect(arrancados).toHaveLength(1);
  });

  it('el clic señala la propuesta pendiente con la persona de la sesión', async () => {
    const { puerto, senales } = puertoFalso();
    const url = `/sala/propuestas/${PROPUESTA}/decision`;
    const decidida = await atender(
      peticion({ metodo: 'POST', url, cuerpo: { sentido: 'aprobada', personaId: 'otra' } }),
      CONFIGURACION,
      puerto,
    );
    expect(decidida?.estado).toBe(202);
    expect(senales).toEqual([
      { id: PROPUESTA, carga: { personaId: PERSONA, sentido: 'aprobada' } },
    ]);
    const mal = await atender(
      peticion({ metodo: 'POST', url, cuerpo: { sentido: 'quizá' } }),
      CONFIGURACION,
      puerto,
    );
    expect(mal?.estado).toBe(400);
  });

  it('una propuesta ya decidida no se vuelve a decidir', async () => {
    const { puerto, senales } = puertoFalso('ejecutada');
    const tarde = await atender(
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
