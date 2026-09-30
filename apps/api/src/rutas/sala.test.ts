import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import {
  atenderSala,
  configuracionSalaDesdeEntorno,
  type ConfiguracionSala,
  type MiembroDeLaVista,
  type PeticionSala,
  type PropuestaDeLaVista,
  type PuertoSala,
  type ResumenSalaDeLaVista,
} from './sala';

const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';
const SALA = '01a0d39e-98c3-7970-814a-0a98ad132313';
const PROPUESTA = '01a0d39e-98c3-7970-814a-0a98ad132314';
const SALA_EQUIPO = '01a0d39e-98c3-7970-814a-0a98ad132315';
const SALA_AJENA = '01a0d39e-98c3-7970-814a-0a98ad132399';
// Nace con la prueba: ni de juguete se escribe una credencial en el código.
const TOKEN = randomUUID();
const SECRETO_HMAC = randomUUID();

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

const CONFIGURACION_V1: ConfiguracionSala = {
  ...CONFIGURACION,
  v1: {
    centrifugo: {
      urlApi: 'http://centrifugo.local:8000',
      claveApi: 'clave',
      secretoHmac: SECRETO_HMAC,
    },
  },
};

function puertoFalso(estadoPropuesta = 'pendiente') {
  const arrancados: unknown[] = [];
  const senales: unknown[] = [];
  const marcadosLeidos: unknown[] = [];
  const avisosDeEscritura: unknown[] = [];
  const propuesta: PropuestaDeLaVista = {
    id: PROPUESTA,
    resumen: 'Contratar Conciliación bancaria en Finanzas',
    estado: estadoPropuesta,
    nivelExigido: 'n1',
    costeEstimadoEuros: 50,
    efectos: {},
  };
  const salas: ResumenSalaDeLaVista[] = [
    { id: SALA, nombre: 'General', ambito: 'general', sinLeer: 0, menciones: 0 },
    { id: SALA_EQUIPO, nombre: 'Sala de Finanzas', ambito: 'equipo', sinLeer: 3, menciones: 1 },
  ];
  const miembros: MiembroDeLaVista[] = [
    { id: PERSONA, tipo: 'persona', nombre: 'Jesús', estado: 'en-la-sala' },
    { id: 'puesto-cobros', tipo: 'agente', nombre: 'Cobros', estado: 'trabajando' },
  ];
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
    esMiembro: (_t, salaId, persona) =>
      Promise.resolve(persona === PERSONA && (salaId === SALA || salaId === SALA_EQUIPO)),
    salasDeLaPersona: () => Promise.resolve(salas),
    miembrosDeSala: () => Promise.resolve(miembros),
    marcarLeido: (tenantId, salaId, personaId) => {
      marcadosLeidos.push({ tenantId, salaId, personaId });
      return Promise.resolve();
    },
    tokenDeSala: (_t, salaId, personaId) =>
      Promise.resolve(
        personaId === PERSONA
          ? { token: 'tok', canalToken: 'canal', canal: `sala:${TENANT}:${salaId}` }
          : null,
      ),
    avisarEscribiendo: (tenantId, salaId, personaId) => {
      avisosDeEscritura.push({ tenantId, salaId, personaId });
      return Promise.resolve();
    },
    // El ajuste de verdad (ADR-026) lo aplica `puertoSala`, no `atenderSala`: se
    // prueba con Postgres real en `apps/api/src/pruebas/sala-puerto.test.ts`.
    mostrarPresencia: () => Promise.resolve(true),
  };
  return { puerto, arrancados, senales, marcadosLeidos, avisosDeEscritura };
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

  it('GET /sala acepta ?salaId= de una sala propia y por defecto usa la general', async () => {
    const { puerto } = puertoFalso();
    const pedida = await atender(
      peticion({ url: `/sala?salaId=${SALA_EQUIPO}` }),
      CONFIGURACION,
      puerto,
    );
    expect(pedida?.cuerpo['salaId']).toBe(SALA_EQUIPO);
    const malFormada = await atender(
      peticion({ url: '/sala?salaId=no-es-uuid' }),
      CONFIGURACION,
      puerto,
    );
    expect(malFormada?.estado).toBe(400);
  });

  it('GET /sala rechaza la sala de otro equipo aunque se conozca su salaId', async () => {
    const { puerto } = puertoFalso();
    const ajena = await atender(
      peticion({ url: `/sala?salaId=${SALA_AJENA}` }),
      CONFIGURACION,
      puerto,
    );
    expect(ajena?.estado).toBe(403);
  });

  it('POST /sala/mensajes acepta salaId en el cuerpo de una sala propia y por defecto usa la general', async () => {
    const { puerto, arrancados } = puertoFalso();
    await atender(
      peticion({
        metodo: 'POST',
        url: '/sala/mensajes',
        cuerpo: { texto: 'hola equipo', salaId: SALA_EQUIPO },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(arrancados).toEqual([expect.objectContaining({ salaId: SALA_EQUIPO })]);
  });

  it('POST /sala/mensajes rechaza escribir en la sala de otro equipo aunque se conozca su salaId', async () => {
    const { puerto, arrancados } = puertoFalso();
    const ajena = await atender(
      peticion({
        metodo: 'POST',
        url: '/sala/mensajes',
        cuerpo: { texto: 'intento ajeno', salaId: SALA_AJENA },
      }),
      CONFIGURACION,
      puerto,
    );
    expect(ajena?.estado).toBe(403);
    expect(arrancados).toEqual([]);
  });
});

describe('rutas de la sala v1', () => {
  it('sin AIW_SALA_V1 o sin la configuración de Centrifugo, ninguna ruta de la v1 existe', async () => {
    const { puerto } = puertoFalso();
    for (const url of [
      '/sala/salas',
      `/sala/${SALA}/miembros`,
      `/sala/${SALA}/token`,
      `/sala/${SALA}/leido`,
      `/sala/${SALA}/escribiendo`,
    ]) {
      const respuesta = await atender(peticion({ url, metodo: 'GET' }), CONFIGURACION, puerto);
      expect(respuesta?.estado, url).toBe(404);
    }
    expect(
      configuracionSalaDesdeEntorno({ AIW_SALA_V0: '1', AIW_SALA_TOKEN: TOKEN, AIW_SALA_V1: '1' })
        ?.v1,
    ).toBeUndefined();
  });

  it('da las salas de la persona, con sin leer y menciones', async () => {
    const { puerto } = puertoFalso();
    const leida = await atender(peticion({ url: '/sala/salas' }), CONFIGURACION_V1, puerto);
    expect(leida?.estado).toBe(200);
    expect(leida?.cuerpo['salas']).toEqual([
      { id: SALA, nombre: 'General', ambito: 'general', sinLeer: 0, menciones: 0 },
      { id: SALA_EQUIPO, nombre: 'Sala de Finanzas', ambito: 'equipo', sinLeer: 3, menciones: 1 },
    ]);
  });

  it('da los miembros de una sala solo a quien es miembro', async () => {
    const { puerto } = puertoFalso();
    const propia = await atender(
      peticion({ url: `/sala/${SALA_EQUIPO}/miembros` }),
      CONFIGURACION_V1,
      puerto,
    );
    expect(propia?.estado).toBe(200);
    expect((propia?.cuerpo['miembros'] as { estado: string }[]).map((m) => m.estado)).toEqual([
      'en-la-sala',
      'trabajando',
    ]);

    const ajena = await atender(
      peticion({ url: `/sala/${SALA_AJENA}/miembros` }),
      CONFIGURACION_V1,
      puerto,
    );
    expect(ajena?.estado).toBe(403);
  });

  it('emite el token de conexión y de canal solo a un miembro', async () => {
    const { puerto } = puertoFalso();
    const token = await atender(
      peticion({ metodo: 'POST', url: `/sala/${SALA}/token` }),
      CONFIGURACION_V1,
      puerto,
    );
    expect(token?.estado).toBe(200);
    expect(token?.cuerpo['canal']).toBe(`sala:${TENANT}:${SALA}`);
  });

  it('marca la sala como leída', async () => {
    const { puerto, marcadosLeidos } = puertoFalso();
    const leido = await atender(
      peticion({ metodo: 'POST', url: `/sala/${SALA}/leido` }),
      CONFIGURACION_V1,
      puerto,
    );
    expect(leido?.estado).toBe(200);
    expect(marcadosLeidos).toEqual([{ tenantId: TENANT, salaId: SALA, personaId: PERSONA }]);
  });

  it('avisa de que la persona está escribiendo', async () => {
    const { puerto, avisosDeEscritura } = puertoFalso();
    const aviso = await atender(
      peticion({ metodo: 'POST', url: `/sala/${SALA}/escribiendo` }),
      CONFIGURACION_V1,
      puerto,
    );
    expect(aviso?.estado).toBe(200);
    expect(avisosDeEscritura).toEqual([{ tenantId: TENANT, salaId: SALA, personaId: PERSONA }]);
  });

  it('la configuración de entorno solo activa la v1 con la bandera y Centrifugo completo', () => {
    const base = {
      AIW_SALA_V0: '1',
      AIW_SALA_TOKEN: TOKEN,
      AIW_SALA_V1: '1',
    };
    expect(configuracionSalaDesdeEntorno(base)?.v1).toBeUndefined();
    expect(
      configuracionSalaDesdeEntorno({
        ...base,
        AIW_CENTRIFUGO_URL: 'http://localhost:8000',
        CENTRIFUGO_API_KEY: 'clave',
        CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: SECRETO_HMAC,
      })?.v1,
    ).toEqual({
      centrifugo: {
        urlApi: 'http://localhost:8000',
        claveApi: 'clave',
        secretoHmac: SECRETO_HMAC,
      },
    });
  });
});
