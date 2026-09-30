import type { AprobacionLeida } from '@aiw/ledger';
import { describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import {
  atenderInicio,
  LONGITUD_MAXIMA_ENCARGO,
  type AgenteDelInicio,
  type AvisoDelInicio,
  type ConfiguracionInicio,
  type DecisionDelInicio,
  type PeticionInicio,
  type PuertoInicio,
  type TareaDeEncargoCreada,
} from './inicio';

const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const OTRO_TENANT = '01a0d39e-98c3-7970-814a-0a98ad132388';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';
const OTRA_PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132399';
const PUESTO = '01a0d39e-98c3-7970-814a-0a98ad132320';
const APROBACION = '01a0d39e-98c3-7970-814a-0a98ad132330';

const SESIONES: Record<string, { tenantId: string; personaId: string }> = {
  'aiw.session_token=valida': { tenantId: TENANT, personaId: PERSONA },
  'aiw.session_token=otro-tenant': { tenantId: OTRO_TENANT, personaId: OTRA_PERSONA },
};

const sesiones: ResolutorDeSesion = (cabeceras) => {
  const sesion = SESIONES[String(cabeceras['cookie'])];
  return Promise.resolve(
    sesion
      ? {
          sesionId: '01a0d39e-98c3-7970-814a-0a98ad132398',
          usuarioId: '01a0d39e-98c3-7970-814a-0a98ad132397',
          nombre: 'Propietaria',
          correo: 'propietaria@ejemplo.local',
          caducaEn: new Date(Date.now() + 3_600_000),
          ...sesion,
        }
      : null,
  );
};

function atender(peticionInicio: PeticionInicio, puerto: PuertoInicio) {
  return atenderInicio(peticionInicio, CONFIGURACION, puerto, sesiones);
}

const CONFIGURACION: ConfiguracionInicio = {
  temporal: { direccion: 'localhost:7233', espacio: 'default', cola: 'cola' },
};

function peticion(parcial: Partial<PeticionInicio> = {}): PeticionInicio {
  return {
    metodo: 'GET',
    url: '/inicio/agentes',
    cabeceras: { cookie: 'aiw.session_token=valida' },
    ...parcial,
  };
}

function aprobacionDeMuestra(parcial: Partial<AprobacionLeida> = {}): AprobacionLeida {
  return {
    id: APROBACION,
    tareaId: '01a0d39e-98c3-7970-814a-0a98ad132340',
    pasoId: null,
    personaId: PERSONA,
    claseAccion: 'escritura_erp',
    nivelExigido: 'n1',
    resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
    venceEn: null,
    creadoEn: new Date('2026-09-30T09:00:00.000Z'),
    puestoId: PUESTO,
    versionPuestoId: '01a0d39e-98c3-7970-814a-0a98ad132321',
    flujoTemporalId: 'flujo-1',
    decision: null,
    ...parcial,
  };
}

function puertoFalso(
  opciones: {
    agentes?: AgenteDelInicio[];
    avisos?: AvisoDelInicio[];
    admiteEncargo?: boolean;
    aprobacion?: AprobacionLeida | null;
    resultadoDecision?: DecisionDelInicio;
  } = {},
) {
  const encargos: unknown[] = [];
  const decisiones: unknown[] = [];
  const puerto: PuertoInicio = {
    agentes: () => Promise.resolve(opciones.agentes ?? []),
    avisos: () => Promise.resolve(opciones.avisos ?? []),
    puestoAdmiteEncargo: () => Promise.resolve(opciones.admiteEncargo ?? true),
    crearTareaDeEncargo: (tenantId, datos) => {
      encargos.push({ tenantId, ...datos });
      const creada: TareaDeEncargoCreada = { tareaId: '01a0d39e-98c3-7970-814a-0a98ad132350' };
      return Promise.resolve(creada);
    },
    aprobacionParaDecidir: () =>
      Promise.resolve(
        'aprobacion' in opciones ? (opciones.aprobacion ?? null) : aprobacionDeMuestra(),
      ),
    decidirAprobacion: (tenantId, datos) => {
      decisiones.push({ tenantId, ...datos });
      return Promise.resolve(opciones.resultadoDecision ?? { decidida: true });
    },
  };
  return { puerto, encargos, decisiones };
}

describe('ruta del inicio', () => {
  it('una ruta que no es /inicio no es suya', async () => {
    const respuesta = await atenderInicio(
      peticion({ url: '/otra' }),
      CONFIGURACION,
      puertoFalso().puerto,
      sesiones,
    );
    expect(respuesta).toBeUndefined();
  });

  it('sin configuración (bandera apagada) la ruta no existe', async () => {
    const respuesta = await atenderInicio(peticion(), undefined, puertoFalso().puerto, sesiones);
    expect(respuesta).toBeUndefined();
  });

  it('sin sesión, 401', async () => {
    const respuesta = await atender(peticion({ cabeceras: {} }), puertoFalso().puerto);
    expect(respuesta?.estado).toBe(401);
  });

  describe('GET /inicio/agentes', () => {
    it('da los agentes de la organización de la sesión', async () => {
      const agente: AgenteDelInicio = {
        puestoId: PUESTO,
        nombre: 'Cobros',
        estado: 'activo',
        departamentoId: '01a0d39e-98c3-7970-814a-0a98ad132360',
        departamento: 'Finanzas',
        salaId: '01a0d39e-98c3-7970-814a-0a98ad132361',
        origenPlantilla: true,
        tareaEnCurso: null,
        ultimasCompletadas: [],
      };
      const { puerto } = puertoFalso({ agentes: [agente] });
      const respuesta = await atender(peticion(), puerto);
      expect(respuesta?.estado).toBe(200);
      expect(respuesta?.cuerpo).toEqual({ agentes: [agente] });
    });

    it('otro método no permitido responde 405', async () => {
      const respuesta = await atender(peticion({ metodo: 'POST' }), puertoFalso().puerto);
      expect(respuesta?.estado).toBe(405);
    });
  });

  describe('GET /inicio/avisos', () => {
    it('da los avisos de la persona de la sesión', async () => {
      const aviso: AvisoDelInicio = {
        aprobacionId: APROBACION,
        tareaId: '01a0d39e-98c3-7970-814a-0a98ad132340',
        puestoId: PUESTO,
        puesto: 'Cobros',
        claseAccion: 'escritura_erp',
        nivelExigido: 'n1',
        resumenLegible: 'Enviar la nota de seguimiento a Contoso.',
        creadoEn: '2026-09-30T09:00:00.000Z',
      };
      const { puerto } = puertoFalso({ avisos: [aviso] });
      const respuesta = await atender(peticion({ url: '/inicio/avisos' }), puerto);
      expect(respuesta?.estado).toBe(200);
      expect(respuesta?.cuerpo).toEqual({ avisos: [aviso] });
    });
  });

  describe('POST /inicio/encargar', () => {
    function peticionDeEncargo(cuerpo: unknown) {
      return peticion({ metodo: 'POST', url: '/inicio/encargar', cuerpo });
    }

    it('crea la tarea y la arranca, con la persona de la sesión y no del cuerpo', async () => {
      const { puerto, encargos } = puertoFalso();
      const respuesta = await atender(
        peticionDeEncargo({ puestoId: PUESTO, encargo: 'Revisa las facturas vencidas de hoy.' }),
        puerto,
      );
      expect(respuesta?.estado).toBe(202);
      expect(respuesta?.cuerpo).toEqual({ tareaId: '01a0d39e-98c3-7970-814a-0a98ad132350' });
      expect(encargos).toEqual([
        {
          tenantId: TENANT,
          puestoId: PUESTO,
          personaId: PERSONA,
          encargo: 'Revisa las facturas vencidas de hoy.',
        },
      ]);
    });

    it('un encargo vacío responde 400', async () => {
      const { puerto, encargos } = puertoFalso();
      const respuesta = await atender(
        peticionDeEncargo({ puestoId: PUESTO, encargo: '   ' }),
        puerto,
      );
      expect(respuesta?.estado).toBe(400);
      expect(encargos).toEqual([]);
    });

    it('un encargo demasiado largo responde 413', async () => {
      const { puerto, encargos } = puertoFalso();
      const respuesta = await atender(
        peticionDeEncargo({ puestoId: PUESTO, encargo: 'x'.repeat(LONGITUD_MAXIMA_ENCARGO + 1) }),
        puerto,
      );
      expect(respuesta?.estado).toBe(413);
      expect(encargos).toEqual([]);
    });

    it('sin un puestoId válido responde 400', async () => {
      const { puerto, encargos } = puertoFalso();
      const respuesta = await atender(peticionDeEncargo({ encargo: 'Hazlo.' }), puerto);
      expect(respuesta?.estado).toBe(400);
      expect(encargos).toEqual([]);
    });

    it('un puesto que no admite encargos responde 404', async () => {
      const { puerto, encargos } = puertoFalso({ admiteEncargo: false });
      const respuesta = await atender(
        peticionDeEncargo({ puestoId: PUESTO, encargo: 'Hazlo.' }),
        puerto,
      );
      expect(respuesta?.estado).toBe(404);
      expect(encargos).toEqual([]);
    });
  });

  describe('POST /inicio/avisos/:id/decidir', () => {
    function peticionDeDecision(sentido: unknown) {
      return peticion({
        metodo: 'POST',
        url: `/inicio/avisos/${APROBACION}/decidir`,
        cuerpo: { sentido },
      });
    }

    it('aprueba y responde 200', async () => {
      const { puerto, decisiones } = puertoFalso();
      const respuesta = await atender(peticionDeDecision('aprobada'), puerto);
      expect(respuesta?.estado).toBe(200);
      expect(respuesta?.cuerpo).toEqual({
        aprobacionId: APROBACION,
        yaEstaba: false,
        sentido: 'aprobada',
      });
      expect(decisiones).toEqual([
        { tenantId: TENANT, aprobacionId: APROBACION, personaId: PERSONA, sentido: 'aprobada' },
      ]);
    });

    it('un sentido que no es aprobada ni rechazada responde 400', async () => {
      const { puerto } = puertoFalso();
      const respuesta = await atender(peticionDeDecision('quizás'), puerto);
      expect(respuesta?.estado).toBe(400);
    });

    it('una aprobación que no existe responde 404', async () => {
      const { puerto } = puertoFalso({ aprobacion: null });
      const respuesta = await atender(peticionDeDecision('aprobada'), puerto);
      expect(respuesta?.estado).toBe(404);
    });

    it('una aprobación pedida a otra persona responde 403 y no decide', async () => {
      const { puerto, decisiones } = puertoFalso({
        aprobacion: aprobacionDeMuestra({ personaId: OTRA_PERSONA }),
      });
      const respuesta = await atender(peticionDeDecision('aprobada'), puerto);
      expect(respuesta?.estado).toBe(403);
      expect(decisiones).toEqual([]);
    });

    it('una aprobación ya decidida es idempotente: 200 sin volver a decidir', async () => {
      const { puerto, decisiones } = puertoFalso({
        aprobacion: aprobacionDeMuestra({
          decision: {
            id: 'decision-1',
            sentido: 'aprobada',
            personaId: PERSONA,
            creadoEn: new Date(),
          },
        }),
      });
      const respuesta = await atender(peticionDeDecision('rechazada'), puerto);
      expect(respuesta?.estado).toBe(200);
      expect(respuesta?.cuerpo).toEqual({
        aprobacionId: APROBACION,
        yaEstaba: true,
        sentido: 'aprobada',
      });
      expect(decisiones).toEqual([]);
    });

    it('si el puerto no puede decidirla (ya vencida, por ejemplo), responde 409', async () => {
      const { puerto } = puertoFalso({ resultadoDecision: { decidida: false, motivo: 'vencida' } });
      const respuesta = await atender(peticionDeDecision('aprobada'), puerto);
      expect(respuesta?.estado).toBe(409);
    });
  });

  it('aislamiento: la sesión de otra organización no ve avisos ni agentes de esta (criterio 10)', async () => {
    const agente: AgenteDelInicio = {
      puestoId: PUESTO,
      nombre: 'Cobros',
      estado: 'activo',
      departamentoId: '01a0d39e-98c3-7970-814a-0a98ad132360',
      departamento: 'Finanzas',
      salaId: null,
      origenPlantilla: true,
      tareaEnCurso: null,
      ultimasCompletadas: [],
    };
    const tenantsVistos: string[] = [];
    const puerto: PuertoInicio = {
      agentes: (tenantId) => {
        tenantsVistos.push(tenantId);
        return Promise.resolve(tenantId === TENANT ? [agente] : []);
      },
      avisos: () => Promise.resolve([]),
      puestoAdmiteEncargo: () => Promise.resolve(true),
      crearTareaDeEncargo: () => Promise.resolve({ tareaId: 'x' }),
      aprobacionParaDecidir: () => Promise.resolve(null),
      decidirAprobacion: () => Promise.resolve({ decidida: false }),
    };
    const respuesta = await atenderInicio(
      peticion({ cabeceras: { cookie: 'aiw.session_token=otro-tenant' } }),
      CONFIGURACION,
      puerto,
      sesiones,
    );
    expect(respuesta?.cuerpo).toEqual({ agentes: [] });
    expect(tenantsVistos).toEqual([OTRO_TENANT]);
  });
});
