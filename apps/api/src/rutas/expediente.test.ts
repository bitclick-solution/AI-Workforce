import { describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import {
  CRITERIOS_DE_ASCENSO,
  atenderExpediente,
  componerExpediente,
  type DatosDelExpediente,
  type ExpedienteDelPuesto,
  type PuertoExpediente,
} from './expediente';

const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const OTRO_TENANT = '01a0d39e-98c3-7970-814a-0a98ad132388';
const PUESTO = '01a0d39e-98c3-7970-814a-0a98ad132320';
const V1 = '01a0d39e-98c3-7970-814a-0a98ad1323a1';
const V2 = '01a0d39e-98c3-7970-814a-0a98ad1323a2';
const V3 = '01a0d39e-98c3-7970-814a-0a98ad1323a3';
const LECCION = '01a0d39e-98c3-7970-814a-0a98ad1323b1';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';
const TAREA = '01a0d39e-98c3-7970-814a-0a98ad132340';

const AHORA = new Date('2026-10-02T10:00:00.000Z');
const dia = (n: number) => new Date(AHORA.getTime() - n * 86_400_000);

function datos(parcial: Partial<DatosDelExpediente> = {}): DatosDelExpediente {
  return {
    puesto: {
      puestoId: PUESTO,
      nombre: 'Cobros',
      departamento: 'Finanzas',
      estado: 'activo',
      clasesFijas: [],
    },
    versionActivaId: V1,
    versiones: [
      {
        versionPuestoId: V1,
        numero: 1,
        creadaEn: dia(60),
        politica: { niveles: { escribir: 'n1', comunicar: 'n1', gastar: 'n0' } },
        lecciones: [],
      },
    ],
    promociones: [],
    lecciones: [],
    acciones: [],
    decisiones: [],
    bajadas: [],
    rechazadas: [],
    totalRechazadas: 0,
    ...parcial,
  };
}

describe('componerExpediente · historial de niveles', () => {
  it('con una sola versión no hay cambios: el nivel de la versión es el inicial', () => {
    const e = componerExpediente(datos(), AHORA);
    expect(e.versionActiva).toEqual({ versionPuestoId: V1, numero: 1 });
    expect(e.versiones).toHaveLength(1);
    expect(e.clases.map((c) => [c.claseAccion, c.nivel, c.historial.length])).toEqual([
      ['comunicar', 'n1', 0],
      ['escribir', 'n1', 0],
      ['gastar', 'n0', 0],
    ]);
  });

  it('sin versiones (puesto propuesto) no hay clases ni versión activa', () => {
    const e = componerExpediente(datos({ versionActivaId: null, versiones: [] }), AHORA);
    expect(e.versionActiva).toBeNull();
    expect(e.clases).toEqual([]);
    expect(e.versiones).toEqual([]);
  });

  it('tres versiones con un nivel distinto en una clase muestran exactamente ese cambio, con fecha y versión', () => {
    const e = componerExpediente(
      datos({
        versionActivaId: V3,
        versiones: [
          {
            versionPuestoId: V1,
            numero: 1,
            creadaEn: dia(60),
            politica: { niveles: { escribir: 'n1', comunicar: 'n1' } },
            lecciones: [],
          },
          {
            versionPuestoId: V2,
            numero: 2,
            creadaEn: dia(30),
            politica: { niveles: { escribir: 'n1', comunicar: 'n1' } },
            lecciones: [LECCION],
          },
          {
            versionPuestoId: V3,
            numero: 3,
            creadaEn: dia(10),
            politica: { niveles: { escribir: 'n2', comunicar: 'n1' } },
            lecciones: [LECCION],
          },
        ],
        promociones: [{ versionPuestoId: V3, leccionId: LECCION, personaId: PERSONA }],
      }),
      AHORA,
    );
    const escribir = e.clases.find((c) => c.claseAccion === 'escribir');
    const comunicar = e.clases.find((c) => c.claseAccion === 'comunicar');
    expect(escribir?.nivel).toBe('n2');
    expect(escribir?.historial).toEqual([
      {
        claseAccion: 'escribir',
        de: 'n1',
        a: 'n2',
        versionPuestoId: V3,
        numeroVersion: 3,
        fecha: dia(10).toISOString(),
        leccionId: LECCION,
        decididaPorPersonaId: PERSONA,
      },
    ]);
    expect(comunicar?.historial).toEqual([]);
  });

  it('una clase que aparece o desaparece entre versiones es un cambio con nivel nulo en un extremo', () => {
    const e = componerExpediente(
      datos({
        versionActivaId: V2,
        versiones: [
          {
            versionPuestoId: V1,
            numero: 1,
            creadaEn: dia(20),
            politica: { niveles: { escribir: 'n1' } },
            lecciones: [],
          },
          {
            versionPuestoId: V2,
            numero: 2,
            creadaEn: dia(5),
            politica: { niveles: { comunicar: 'n0' } },
            lecciones: [],
          },
        ],
      }),
      AHORA,
    );
    const cambios = e.clases.flatMap((c) => c.historial).map((h) => [h.claseAccion, h.de, h.a]);
    expect(cambios).toEqual(
      expect.arrayContaining([
        ['escribir', 'n1', null],
        ['comunicar', null, 'n0'],
      ]),
    );
    expect(e.clases.find((c) => c.claseAccion === 'escribir')?.nivel).toBeNull();
  });

  it('una política que no valida se lee como sin niveles, no rompe el expediente', () => {
    const e = componerExpediente(
      datos({
        versiones: [
          {
            versionPuestoId: V1,
            numero: 1,
            creadaEn: dia(1),
            politica: { niveles: { escribir: 'n9' } },
            lecciones: [],
          },
        ],
      }),
      AHORA,
    );
    expect(e.clases).toEqual([]);
  });
});

describe('componerExpediente · avance hacia el ascenso', () => {
  it('una clase N1 con datos completos enseña los cuatro criterios con su valor actual', () => {
    const e = componerExpediente(
      datos({
        acciones: [{ claseAccion: 'escribir', ejecutadas: 31, primeraEn: dia(45) }],
        decisiones: [{ claseAccion: 'escribir', aprobadas: 30, total: 31 }],
      }),
      AHORA,
    );
    const a = e.clases.find((c) => c.claseAccion === 'escribir')?.ascenso;
    expect(a).toMatchObject({
      de: 'n1',
      a: 'n2',
      acciones: { actual: 31, requerido: CRITERIOS_DE_ASCENSO.acciones, cumplido: true },
      aprobadasSinCambiosPct: { requerido: CRITERIOS_DE_ASCENSO.porcentajeSinCambios },
      diasSinIncidentes: {
        actual: 45,
        requerido: CRITERIOS_DE_ASCENSO.diasSinIncidentes,
        cumplido: true,
      },
      confirmacion: { confirmada: false, cumplido: false },
      cumplidos: 3,
      total: 4,
    });
    expect(a?.aprobadasSinCambiosPct.actual).toBeCloseTo(96.8, 1);
    expect(a?.aprobadasSinCambiosPct.cumplido).toBe(true);
  });

  it('con datos insuficientes los criterios sin dato quedan en nulo y sin cumplir', () => {
    const e = componerExpediente(datos(), AHORA);
    const a = e.clases.find((c) => c.claseAccion === 'escribir')?.ascenso;
    expect(a?.acciones).toEqual({ actual: 0, requerido: 30, cumplido: false });
    expect(a?.aprobadasSinCambiosPct).toEqual({ actual: null, requerido: 95, cumplido: false });
    expect(a?.diasSinIncidentes).toEqual({ actual: null, requerido: 30, cumplido: false });
    expect(a?.cumplidos).toBe(0);
  });

  it('una bajada de nivel reciente reinicia los días sin incidentes', () => {
    const e = componerExpediente(
      datos({
        acciones: [{ claseAccion: 'escribir', ejecutadas: 40, primeraEn: dia(50) }],
        bajadas: [{ claseAccion: 'escribir', creadoEn: dia(4) }],
      }),
      AHORA,
    );
    const a = e.clases.find((c) => c.claseAccion === 'escribir')?.ascenso;
    expect(a?.diasSinIncidentes).toEqual({ actual: 4, requerido: 30, cumplido: false });
  });

  it('las clases fijas no enseñan avance y lo dicen', () => {
    const e = componerExpediente(
      datos({ puesto: { ...datos().puesto, clasesFijas: ['comunicar'] } }),
      AHORA,
    );
    const fija = e.clases.find((c) => c.claseAccion === 'comunicar');
    expect(fija?.ascenso).toBeNull();
    expect(fija?.sinAscenso).toBe('fijo');
  });

  it('N0 sin ascenso definido, prohibida y N3 no enseñan avance, cada una con su motivo', () => {
    const e = componerExpediente(
      datos({
        versiones: [
          {
            versionPuestoId: V1,
            numero: 1,
            creadaEn: dia(1),
            politica: {
              niveles: { gastar: 'n0', leer: 'n3', pagar: 'n1' },
              clasesProhibidas: ['pagar'],
            },
            lecciones: [],
          },
        ],
      }),
      AHORA,
    );
    const por = Object.fromEntries(e.clases.map((c) => [c.claseAccion, c]));
    expect(por['gastar']?.ascenso).toBeNull();
    expect(por['gastar']?.sinAscenso).toBe('sin_criterio');
    expect(por['leer']?.sinAscenso).toBe('nivel_maximo');
    expect(por['pagar']?.prohibida).toBe(true);
    expect(por['pagar']?.sinAscenso).toBe('prohibida');
  });
});

describe('componerExpediente · lecciones y rechazadas', () => {
  it('conserva las lecciones con su estado y las acciones rechazadas con su enlace al libro', () => {
    const e = componerExpediente(
      datos({
        lecciones: [
          {
            leccionId: LECCION,
            titulo: 'Tono más cercano',
            linea: 'Saluda por el nombre.',
            estado: 'vigente',
            promocionId: null,
            versionPuestoId: V1,
          },
        ],
        rechazadas: [
          {
            numeroOrden: 7,
            tareaId: TAREA,
            claseAccion: 'comunicar',
            herramienta: 'enviar_aviso',
            nivel: 'n0',
            costeEuros: 0,
            porque: 'La política del puesto no permite esta clase.',
            creadoEn: dia(2),
          },
        ],
        totalRechazadas: 1,
      }),
      AHORA,
    );
    expect(e.lecciones.map((l) => l.estado)).toEqual(['vigente']);
    expect(e.rechazadas).toEqual([
      {
        numeroOrden: 7,
        tareaId: TAREA,
        claseAccion: 'comunicar',
        herramienta: 'enviar_aviso',
        nivel: 'n0',
        costeEuros: 0,
        porque: 'La política del puesto no permite esta clase.',
        creadoEn: dia(2).toISOString(),
      },
    ]);
    expect(e.totalRechazadas).toBe(1);
  });
});

const SESIONES: Record<string, { tenantId: string; personaId: string }> = {
  'aiw.session_token=valida': { tenantId: TENANT, personaId: PERSONA },
  'aiw.session_token=otro': { tenantId: OTRO_TENANT, personaId: PERSONA },
};
const sesiones: ResolutorDeSesion = (cabeceras) => {
  const s = SESIONES[String(cabeceras['cookie'])];
  return Promise.resolve(
    s
      ? {
          sesionId: '01a0d39e-98c3-7970-814a-0a98ad132398',
          usuarioId: '01a0d39e-98c3-7970-814a-0a98ad132397',
          nombre: 'Propietaria',
          correo: 'propietaria@ejemplo.local',
          caducaEn: new Date(Date.now() + 3_600_000),
          ...s,
        }
      : null,
  );
};

function puerto(): PuertoExpediente & { llamadas: [string, string][] } {
  const llamadas: [string, string][] = [];
  const expediente = componerExpediente(datos(), AHORA);
  return {
    llamadas,
    expediente(tenantId, puestoId): Promise<ExpedienteDelPuesto | null> {
      llamadas.push([tenantId, puestoId]);
      return Promise.resolve(tenantId === TENANT && puestoId === PUESTO ? expediente : null);
    },
  };
}

const pedir = (
  url: string,
  cookie: string | undefined,
  p: PuertoExpediente,
  metodo = 'GET',
  activo = true,
) => atenderExpediente({ metodo, url, cabeceras: cookie ? { cookie } : {} }, activo, p, sesiones);

describe('atenderExpediente', () => {
  it('devuelve el expediente de un puesto de la organización de la sesión', async () => {
    const p = puerto();
    const r = await pedir(`/puestos/${PUESTO}/expediente`, 'aiw.session_token=valida', p);
    expect(r?.estado).toBe(200);
    expect((r?.cuerpo as { expediente: ExpedienteDelPuesto }).expediente.puestoId).toBe(PUESTO);
    expect(r?.cabeceras['cache-control']).toBe('no-store');
    expect(p.llamadas).toEqual([[TENANT, PUESTO]]);
  });

  it('un puesto de otra organización responde no encontrado, igual que uno que no existe', async () => {
    const p = puerto();
    const ajeno = await pedir(`/puestos/${PUESTO}/expediente`, 'aiw.session_token=otro', p);
    const inexistente = await pedir(
      '/puestos/01a0d39e-98c3-7970-814a-0a98ad1329ff/expediente',
      'aiw.session_token=valida',
      p,
    );
    expect(ajeno?.estado).toBe(404);
    expect(inexistente?.estado).toBe(404);
    expect(ajeno?.cuerpo).toEqual(inexistente?.cuerpo);
  });

  it('sin sesión 401; con otro método 405; con identificador no válido 400', async () => {
    const p = puerto();
    expect((await pedir(`/puestos/${PUESTO}/expediente`, undefined, p))?.estado).toBe(401);
    expect(
      (await pedir(`/puestos/${PUESTO}/expediente`, 'aiw.session_token=valida', p, 'POST'))?.estado,
    ).toBe(405);
    expect(
      (await pedir('/puestos/no-es-uuid/expediente', 'aiw.session_token=valida', p))?.estado,
    ).toBe(400);
    expect(p.llamadas).toEqual([]);
  });

  it('no atiende rutas ajenas ni responde si la bandera está apagada', async () => {
    const p = puerto();
    expect(await pedir('/inicio/agentes', 'aiw.session_token=valida', p)).toBeUndefined();
    expect(
      await pedir(`/puestos/${PUESTO}/expediente`, 'aiw.session_token=valida', p, 'GET', false),
    ).toBeUndefined();
  });

  it('el fallo del puerto no se cuela en la respuesta como detalle interno', async () => {
    const roto: PuertoExpediente = {
      expediente: () => Promise.reject(new Error('boom postgres://x')),
    };
    await expect(
      pedir(`/puestos/${PUESTO}/expediente`, 'aiw.session_token=valida', roto),
    ).rejects.toThrow('boom');
  });
});
