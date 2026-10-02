/**
 * Expediente de un agente en el panel: con qué nivel trabaja en cada clase de
 * acción, cómo ha cambiado, qué ha aprendido, qué intentó que la política
 * rechazó y cuánto le falta para subir (docs/specs/expediente-por-agente-n0-n1.md).
 *
 * Solo lectura y sin tablas nuevas: el historial de niveles se deriva de las
 * versiones inmutables del puesto (cada una congela su política) y lo demás sale
 * del libro de auditoría y de las decisiones de aprobación. Consultarlo no emite
 * entrada en el libro ni suma al contador: no es una acción del agente.
 *
 * Como `inicio.ts`, se parte en dos: `componerExpediente` y `atenderExpediente` no
 * saben nada de PostgreSQL y se prueban con datos y un puerto falsos;
 * `puertoExpediente` es el de verdad. Va detrás de la bandera del Inicio porque
 * es una pantalla del panel, no una funcionalidad aparte.
 */
import { conTenant } from '@aiw/db';
import { NIVELES, esquemas, type Nivel } from '@aiw/domain';
import { leerExpediente, type LeccionDelExpediente } from '@aiw/learning';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';
import type { RespuestaContador } from './contador.js';
import { referenciaDe } from './inicio.js';

export const PREFIJO_PUESTOS = '/puestos';

/** Criterios de ascenso a N2 del ADR-005. */
export const CRITERIOS_DE_ASCENSO = {
  acciones: 30,
  porcentajeSinCambios: 95,
  diasSinIncidentes: 30,
} as const;

/** Cuántas acciones rechazadas se enseñan; el total real va aparte. */
export const MAXIMO_DE_RECHAZADAS = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MS_POR_DIA = 86_400_000;

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export interface CambioDeNivelDelExpediente {
  claseAccion: string;
  /** `null`: la clase no estaba en la política de la versión anterior. */
  de: Nivel | null;
  /** `null`: la clase ya no está en la política de esta versión. */
  a: Nivel | null;
  versionPuestoId: string;
  numeroVersion: number;
  fecha: string;
  /** Lección promocionada que produjo la versión, si la hubo. */
  leccionId: string | null;
  /** Persona que decidió la promoción, si la hubo. Solo su identificador. */
  decididaPorPersonaId: string | null;
}

export interface VersionDelExpediente {
  versionPuestoId: string;
  numero: number;
  creadaEn: string;
  niveles: Record<string, Nivel>;
  clasesProhibidas: string[];
  lecciones: string[];
}

export interface CriterioNumerico {
  /** `null`: todavía no hay datos para calcularlo. */
  actual: number | null;
  requerido: number;
  cumplido: boolean;
}

export interface AvanceHaciaElAscenso {
  de: Nivel;
  a: Nivel;
  acciones: CriterioNumerico;
  aprobadasSinCambiosPct: CriterioNumerico;
  diasSinIncidentes: CriterioNumerico;
  /** La confirmación del supervisor todavía no tiene origen de datos: siempre sin confirmar. */
  confirmacion: { confirmada: boolean; cumplido: boolean };
  cumplidos: number;
  total: 4;
}

/** Por qué una clase no enseña avance: «fijo» es la decisión de la ficha de producto. */
export type MotivoSinAscenso = 'fijo' | 'prohibida' | 'nivel_maximo' | 'sin_criterio';

export interface ClaseDelExpediente {
  claseAccion: string;
  /** Nivel de la versión activa; `null` si la versión activa ya no la lleva. */
  nivel: Nivel | null;
  prohibida: boolean;
  ascenso: AvanceHaciaElAscenso | null;
  sinAscenso: MotivoSinAscenso | null;
  historial: CambioDeNivelDelExpediente[];
}

export interface AccionRechazadaDelExpediente {
  numeroOrden: number;
  /** Para enlazar al paso en el detalle de la tarea. */
  tareaId: string | null;
  claseAccion: string;
  herramienta: string | null;
  nivel: Nivel | null;
  costeEuros: number;
  porque: string | null;
  creadoEn: string;
}

export interface ExpedienteDelPuesto {
  puestoId: string;
  nombre: string;
  departamento: string;
  estado: string;
  versionActiva: { versionPuestoId: string; numero: number } | null;
  versiones: VersionDelExpediente[];
  clases: ClaseDelExpediente[];
  lecciones: LeccionDelExpediente[];
  rechazadas: AccionRechazadaDelExpediente[];
  totalRechazadas: number;
}

// ---------------------------------------------------------------------------
// Composición (pura)
// ---------------------------------------------------------------------------

export interface DatosDelExpediente {
  puesto: {
    puestoId: string;
    nombre: string;
    departamento: string;
    estado: string;
    clasesFijas: string[];
  };
  versionActivaId: string | null;
  versiones: {
    versionPuestoId: string;
    numero: number;
    creadaEn: Date;
    politica: unknown;
    lecciones: string[];
  }[];
  promociones: { versionPuestoId: string; leccionId: string; personaId: string | null }[];
  lecciones: LeccionDelExpediente[];
  /** Llamadas de herramienta con éxito por clase de acción. */
  acciones: { claseAccion: string; ejecutadas: number; primeraEn: Date | null }[];
  /** Decisiones de aprobación por clase: `aprobadas` es «sin cambios»; `total` incluye editadas y rechazadas. */
  decisiones: { claseAccion: string; aprobadas: number; total: number }[];
  /** Bajadas de nivel anotadas en el libro (incidentes). */
  bajadas: { claseAccion: string; creadoEn: Date }[];
  rechazadas: {
    numeroOrden: number;
    tareaId: string | null;
    claseAccion: string;
    herramienta: string | null;
    nivel: Nivel | null;
    costeEuros: number;
    porque: string | null;
    creadoEn: Date;
  }[];
  totalRechazadas: number;
}

interface PoliticaLeida {
  niveles: Record<string, Nivel>;
  clasesProhibidas: string[];
}

/** Una política que no valida se lee como vacía: el expediente se enseña igualmente. */
function leerPolitica(valor: unknown): PoliticaLeida {
  const r = esquemas.politicaPuesto.safeParse(valor);
  return r.success
    ? {
        niveles: r.data.niveles as Record<string, Nivel>,
        clasesProhibidas: r.data.clasesProhibidas,
      }
    : { niveles: {}, clasesProhibidas: [] };
}

function criterio(actual: number | null, requerido: number): CriterioNumerico {
  return { actual, requerido, cumplido: actual !== null && actual >= requerido };
}

function avance(claseAccion: string, d: DatosDelExpediente, ahora: Date): AvanceHaciaElAscenso {
  const acciones = d.acciones.find((a) => a.claseAccion === claseAccion);
  const decisiones = d.decisiones.find((a) => a.claseAccion === claseAccion);
  const ejecutadas = acciones?.ejecutadas ?? 0;

  const porcentaje =
    decisiones && decisiones.total > 0 ? (decisiones.aprobadas / decisiones.total) * 100 : null;

  const ultimaBajada = d.bajadas
    .filter((b) => b.claseAccion === claseAccion)
    .reduce<Date | null>((max, b) => (max === null || b.creadoEn > max ? b.creadoEn : max), null);
  const desde = ultimaBajada ?? acciones?.primeraEn ?? null;
  const dias = desde
    ? Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / MS_POR_DIA))
    : null;

  const numericos = [
    criterio(ejecutadas, CRITERIOS_DE_ASCENSO.acciones),
    criterio(porcentaje, CRITERIOS_DE_ASCENSO.porcentajeSinCambios),
    criterio(dias, CRITERIOS_DE_ASCENSO.diasSinIncidentes),
  ] as const;
  return {
    de: 'n1',
    a: 'n2',
    acciones: numericos[0],
    aprobadasSinCambiosPct: numericos[1],
    diasSinIncidentes: numericos[2],
    confirmacion: { confirmada: false, cumplido: false },
    cumplidos: numericos.filter((c) => c.cumplido).length,
    total: 4,
  };
}

export function componerExpediente(d: DatosDelExpediente, ahora: Date): ExpedienteDelPuesto {
  const versiones = [...d.versiones].sort((a, b) => a.numero - b.numero);
  const politicas = new Map(versiones.map((v) => [v.versionPuestoId, leerPolitica(v.politica)]));
  const activa = versiones.find((v) => v.versionPuestoId === d.versionActivaId);
  const politicaActiva = activa ? politicas.get(activa.versionPuestoId) : undefined;

  const cambios: CambioDeNivelDelExpediente[] = [];
  for (let i = 1; i < versiones.length; i += 1) {
    const anterior = versiones[i - 1];
    const actual = versiones[i];
    if (!anterior || !actual) continue;
    const antes = politicas.get(anterior.versionPuestoId)?.niveles ?? {};
    const despues = politicas.get(actual.versionPuestoId)?.niveles ?? {};
    const promocion = d.promociones.find((p) => p.versionPuestoId === actual.versionPuestoId);
    for (const claseAccion of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
      const de = antes[claseAccion] ?? null;
      const a = despues[claseAccion] ?? null;
      if (de === a) continue;
      cambios.push({
        claseAccion,
        de,
        a,
        versionPuestoId: actual.versionPuestoId,
        numeroVersion: actual.numero,
        fecha: actual.creadaEn.toISOString(),
        leccionId: promocion?.leccionId ?? null,
        decididaPorPersonaId: promocion?.personaId ?? null,
      });
    }
  }

  const nombresDeClase = new Set<string>();
  for (const p of politicas.values()) {
    for (const c of Object.keys(p.niveles)) nombresDeClase.add(c);
    for (const c of p.clasesProhibidas) nombresDeClase.add(c);
  }

  const clases: ClaseDelExpediente[] = [...nombresDeClase].sort().map((claseAccion) => {
    const prohibida = politicaActiva?.clasesProhibidas.includes(claseAccion) ?? false;
    const nivel = politicaActiva?.niveles[claseAccion] ?? null;
    let sinAscenso: MotivoSinAscenso | null = null;
    if (prohibida) sinAscenso = 'prohibida';
    else if (d.puesto.clasesFijas.includes(claseAccion)) sinAscenso = 'fijo';
    else if (nivel === 'n3') sinAscenso = 'nivel_maximo';
    else if (nivel !== 'n1') sinAscenso = 'sin_criterio';
    return {
      claseAccion,
      nivel,
      prohibida,
      ascenso: nivel === 'n1' && sinAscenso === null ? avance(claseAccion, d, ahora) : null,
      sinAscenso: nivel === null && !prohibida ? null : sinAscenso,
      historial: cambios.filter((c) => c.claseAccion === claseAccion),
    };
  });

  return {
    puestoId: d.puesto.puestoId,
    nombre: d.puesto.nombre,
    departamento: d.puesto.departamento,
    estado: d.puesto.estado,
    versionActiva: activa
      ? { versionPuestoId: activa.versionPuestoId, numero: activa.numero }
      : null,
    versiones: versiones.map((v) => {
      const p = politicas.get(v.versionPuestoId);
      return {
        versionPuestoId: v.versionPuestoId,
        numero: v.numero,
        creadaEn: v.creadaEn.toISOString(),
        niveles: p?.niveles ?? {},
        clasesProhibidas: p?.clasesProhibidas ?? [],
        lecciones: v.lecciones,
      };
    }),
    clases,
    lecciones: d.lecciones,
    rechazadas: d.rechazadas.map((r) => ({ ...r, creadoEn: r.creadoEn.toISOString() })),
    totalRechazadas: d.totalRechazadas,
  };
}

// ---------------------------------------------------------------------------
// Ruta
// ---------------------------------------------------------------------------

/** Lo que la ruta necesita de fuera. `null` si el puesto no existe en el tenant. */
export interface PuertoExpediente {
  expediente(tenantId: string, puestoId: string): Promise<ExpedienteDelPuesto | null>;
}

export interface PeticionExpediente {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaContador {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

export async function atenderExpediente(
  peticion: PeticionExpediente,
  activo: boolean,
  puerto: PuertoExpediente,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaContador | undefined> {
  const [camino = '/'] = (peticion.url ?? '/').split('?');
  const m = new RegExp(`^${PREFIJO_PUESTOS}/([^/]+)/expediente$`).exec(camino);
  if (!m || !activo) return undefined;

  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  if (peticion.metodo !== 'GET') {
    return respuesta(405, { error: 'El expediente se lee con GET.' });
  }
  const puestoId = m[1] ?? '';
  if (!UUID.test(puestoId)) return respuesta(400, { error: 'Ese puesto no es válido.' });

  const expediente = await puerto.expediente(sesion.tenantId, puestoId);
  // Misma respuesta si no existe o es de otra organización: no revela cuál de las dos.
  if (!expediente) return respuesta(404, { error: 'Ese puesto no existe.' });
  return respuesta(200, { expediente });
}

// ---------------------------------------------------------------------------
// Puerto real
// ---------------------------------------------------------------------------

function nivelValido(valor: unknown): Nivel | null {
  return typeof valor === 'string' && (NIVELES as readonly string[]).includes(valor)
    ? (valor as Nivel)
    : null;
}

function clasesFijasDeLaFicha(ficha: unknown): string[] {
  const valor = (ficha as { clasesFijas?: unknown } | null)?.clasesFijas;
  return Array.isArray(valor) ? valor.filter((c): c is string => typeof c === 'string') : [];
}

export function puertoExpediente(
  cliente: postgres.Sql,
  ahora: () => Date = () => new Date(),
): PuertoExpediente {
  return {
    async expediente(tenantId, puestoId) {
      const datos = await conTenant(cliente, tenantId, async (tx) => {
        const [puesto] = await tx<
          {
            id: string;
            nombre: string;
            estado: string;
            ficha: unknown;
            version_activa_id: string | null;
            departamento: string;
          }[]
        >`
          select p.id, p.nombre, p.estado::text as estado, p.ficha, p.version_activa_id,
            d.nombre as departamento
          from puesto p
          join departamento d on d.tenant_id = p.tenant_id and d.id = p.departamento_id
          where p.tenant_id = ${tenantId} and p.id = ${puestoId}
        `;
        if (!puesto) return null;

        const versiones = await tx<
          { id: string; numero: string; creado_en: Date; politica: unknown }[]
        >`
          select id, numero, creado_en, politica from version_puesto
          where tenant_id = ${tenantId} and puesto_id = ${puestoId}
          order by numero
        `;
        const promociones = await tx<
          { version_id: string; leccion_id: string; persona_id: string | null }[]
        >`
          select pr.version_puesto_resultante_id as version_id, pr.leccion_id,
            pr.decidida_por_persona_id as persona_id
          from promocion pr
          join leccion l on l.tenant_id = pr.tenant_id and l.id = pr.leccion_id
          where pr.tenant_id = ${tenantId} and l.puesto_id = ${puestoId}
          order by pr.creado_en
        `;
        const acciones = await tx<{ clase: string; n: number; primera: Date }[]>`
          select ref->>'id' as clase, count(*)::int as n, min(e.creado_en) as primera
          from entrada_auditoria e
          cross join lateral jsonb_array_elements(e.datos_referenciados) as ref
          where e.tenant_id = ${tenantId} and e.puesto_id = ${puestoId}
            and e.accion = 'herramienta.llamada' and e.resultado = 'exito'
            and ref->>'tipo' = 'clase_accion'
          group by 1
        `;
        const decisiones = await tx<{ clase: string; aprobadas: number; total: number }[]>`
          select a.clase_accion as clase,
            (count(*) filter (where d.sentido = 'aprobada'))::int as aprobadas,
            count(*)::int as total
          from aprobacion a
          join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
          join decision_aprobacion d on d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
          where a.tenant_id = ${tenantId} and t.puesto_id = ${puestoId}
            and d.sentido in ('aprobada', 'editada', 'rechazada')
          group by 1
        `;
        const bajadas = await tx<{ cambio: unknown; creado_en: Date }[]>`
          select cambio_de_nivel as cambio, creado_en from entrada_auditoria
          where tenant_id = ${tenantId} and puesto_id = ${puestoId}
            and cambio_de_nivel is not null
        `;
        const rechazadas = await tx<
          {
            numero_orden: string;
            tarea_id: string | null;
            herramienta: string | null;
            nivel_aplicado: string | null;
            coste_euros: string;
            datos_referenciados: unknown;
            creado_en: Date;
          }[]
        >`
          select numero_orden, tarea_id, herramienta, nivel_aplicado::text as nivel_aplicado,
            coste_euros::text as coste_euros, datos_referenciados, creado_en
          from entrada_auditoria
          where tenant_id = ${tenantId} and puesto_id = ${puestoId}
            and accion = 'herramienta.rechazada' and resultado = 'rechazado'
            and datos_referenciados @> '[{"tipo": "clase_accion"}]'::jsonb
          order by numero_orden desc
          limit ${MAXIMO_DE_RECHAZADAS}
        `;
        const [{ total } = { total: 0 }] = await tx<{ total: number }[]>`
          select count(*)::int as total from entrada_auditoria
          where tenant_id = ${tenantId} and puesto_id = ${puestoId}
            and accion = 'herramienta.rechazada' and resultado = 'rechazado'
            and datos_referenciados @> '[{"tipo": "clase_accion"}]'::jsonb
        `;
        return { puesto, versiones, promociones, acciones, decisiones, bajadas, rechazadas, total };
      });
      if (!datos) return null;
      const { puesto } = datos;

      // Lecciones y qué lecciones lleva cada versión: lo calcula `leerExpediente`.
      const aprendizaje = puesto.version_activa_id
        ? await leerExpediente(cliente, tenantId, puestoId)
        : null;
      const leccionesDe = new Map(
        (aprendizaje?.versiones ?? []).map((v) => [v.versionPuestoId, v.lecciones]),
      );

      return componerExpediente(
        {
          puesto: {
            puestoId: puesto.id,
            nombre: puesto.nombre,
            departamento: puesto.departamento,
            estado: puesto.estado,
            clasesFijas: clasesFijasDeLaFicha(puesto.ficha),
          },
          versionActivaId: puesto.version_activa_id,
          versiones: datos.versiones.map((v) => ({
            versionPuestoId: v.id,
            numero: Number(v.numero),
            creadaEn: v.creado_en,
            politica: v.politica,
            lecciones: leccionesDe.get(v.id) ?? [],
          })),
          promociones: datos.promociones.map((p) => ({
            versionPuestoId: p.version_id,
            leccionId: p.leccion_id,
            personaId: p.persona_id,
          })),
          lecciones: aprendizaje?.lecciones ?? [],
          acciones: datos.acciones.map((a) => ({
            claseAccion: a.clase,
            ejecutadas: a.n,
            primeraEn: a.primera,
          })),
          decisiones: datos.decisiones.map((d) => ({
            claseAccion: d.clase,
            aprobadas: d.aprobadas,
            total: d.total,
          })),
          bajadas: datos.bajadas.flatMap((b) => {
            const c = esquemas.cambioDeNivel.safeParse(b.cambio);
            if (!c.success || c.data.de === null) return [];
            const rango = (n: Nivel) => NIVELES.indexOf(n);
            return rango(c.data.a) < rango(c.data.de)
              ? [{ claseAccion: c.data.claseAccion, creadoEn: b.creado_en }]
              : [];
          }),
          rechazadas: datos.rechazadas.map((r) => ({
            numeroOrden: Number(r.numero_orden),
            tareaId: r.tarea_id,
            claseAccion: referenciaDe(r.datos_referenciados, 'clase_accion') ?? '',
            herramienta: r.herramienta,
            nivel: nivelValido(r.nivel_aplicado),
            costeEuros: Number(r.coste_euros),
            porque: referenciaDe(r.datos_referenciados, 'motivo'),
            creadoEn: r.creado_en,
          })),
          totalRechazadas: datos.total,
        },
        ahora(),
      );
    },
  };
}
