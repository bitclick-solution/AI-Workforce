/**
 * Rutas del inicio del panel: los agentes de la organización en tiempo real, sus
 * avisos («Te necesitan») y las dos escrituras mínimas — encargar una tarea por
 * frase y decidir una aprobación en línea (docs/specs/inicio-panel-widgets-avisos.md).
 *
 * Nace después de «Acceso al panel», así que no lleva el token propio de `/sala` ni
 * de `/contador` (esas dos son de antes de que existiera la sesión): la sesión ya
 * es la prueba de que quien llama es el panel, igual que en `/perfil`. Lleva su
 * propia bandera de funcionalidad (`AIW_INICIO_PANEL`) porque la definición de
 * hecho la pide hasta la demo, no porque haga falta un segundo secreto.
 *
 * El tenant y la persona salen siempre de la sesión que `apps/api` ya valida en el
 * servidor; el cuerpo de la petición nunca los trae (aislamiento, criterio de hecho
 * 10). Encargar y decidir están detrás de la misma sesión que protege el resto del
 * panel desde «Acceso al panel», así que la única defensa contra CSRF que hace
 * falta es la que ya tiene esa sesión (cookie `SameSite=Lax` de Better Auth): igual
 * que `/perfil` y que `/sala/mensajes`, esta ruta no añade un token de CSRF propio
 * porque el resto de `apps/api` tampoco lo hace.
 *
 * Como `sala.ts`, se parte en dos: `atenderInicio` no sabe nada de PostgreSQL ni de
 * Temporal y se prueba con un puerto falso; `puertoInicio` es el de verdad, con el
 * mismo `ClienteDeFlujos` que ya usa la sala v0 para arrancar y señalar flujos.
 */
import { conTenant, uuidV7 } from '@aiw/db';
import {
  cargaDeSenal,
  leerAprobacion,
  registrarDecision,
  registrarTareaRaiz,
  type AprobacionLeida,
} from '@aiw/ledger';
// Aparte del índice del paquete: usa `node:crypto`, igual que en `sala.ts`, y por
// la misma razón no se importa desde el índice de `@aiw/rooms`.
import {
  publicarEnSala,
  type BuscadorCentrifugo,
  type ConfiguracionCentrifugo,
} from '@aiw/rooms/centrifugo';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';
import type { RespuestaContador } from './contador.js';
import type { ClienteDeFlujos } from './sala.js';

export const BANDERA_INICIO = 'AIW_INICIO_PANEL';
export const PREFIJO_INICIO = '/inicio';

/** Encargo vacío o más largo que esto: 400/413 (criterio de hecho, casos de prueba). */
export const LONGITUD_MAXIMA_ENCARGO = 2000;

/** Validez por defecto de cada aprobación que pida el agente durante el encargo. */
const VALIDEZ_APROBACION_SEGUNDOS_POR_DEFECTO = 3600;

/** Nombre de la señal, igual que en «Aprobación por correo v0» y en `demo-cobros.ts`. */
const SENAL_DECISION_APROBACION = 'decisionDeAprobacion';

/** Nombre del flujo, tal como lo exporta `apps/worker/src/flujos/index.ts`. `apps/api` no
 * puede importar `apps/worker` (los paquetes no importan aplicaciones): arranca por
 * nombre, igual que hace `sala.ts` con `FLUJO_MENSAJE_DE_SALA`. */
const FLUJO_TAREA_AGENTE = 'tareaAgente';

/** Puestos que aceptan trabajo nuevo. Los demás no toman ningún paso (`packages/domain/politicas.ts`). */
const ESTADOS_QUE_TRABAJAN = new Set(['activo', 'en_prueba', 'degradado']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function inicioActivo(entorno: Record<string, string | undefined>): boolean {
  return entorno[BANDERA_INICIO] === '1' || entorno[BANDERA_INICIO] === 'true';
}

export interface ConfiguracionInicio {
  temporal: { direccion: string; espacio: string; cola: string };
  /** Best-effort: sin ella, la tarjeta del inicio sigue viva por consulta periódica. */
  centrifugo?: ConfiguracionCentrifugo | undefined;
}

export function configuracionInicioDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionInicio | undefined {
  if (!inicioActivo(entorno)) return undefined;
  const urlApi = entorno['AIW_CENTRIFUGO_URL']?.trim();
  const claveApi = entorno['CENTRIFUGO_API_KEY']?.trim();
  const secretoHmac = entorno['CENTRIFUGO_TOKEN_HMAC_SECRET_KEY']?.trim();
  const centrifugo =
    urlApi && claveApi && secretoHmac ? { urlApi, claveApi, secretoHmac } : undefined;
  return {
    temporal: {
      direccion: entorno['AIW_TEMPORAL_DIRECCION']?.trim() || 'localhost:7233',
      espacio: entorno['AIW_TEMPORAL_ESPACIO']?.trim() || 'default',
      cola: entorno['AIW_TEMPORAL_COLA']?.trim() || 'aiw-prueba-stack',
    },
    ...(centrifugo ? { centrifugo } : {}),
  };
}

export interface TareaDelInicio {
  tareaId: string;
  encargo: string;
  estado: string;
  desde: string;
}

export interface AgenteDelInicio {
  puestoId: string;
  nombre: string;
  /** Estado del ciclo de vida del puesto: propuesto, en_prueba, activo, pausado, degradado, dado_de_baja. */
  estado: string;
  departamentoId: string;
  departamento: string;
  /** Sala del departamento, para el enlace de la tarjeta (Sala v1). Sin sala, no hay enlace. */
  salaId: string | null;
  /**
   * Sello de plantilla o de puesto propio (ADR-019). La columna de origen todavía
   * no existe —la trae la migración con revisión humana de ADR-019, fuera de esta
   * rebanada—, así que hoy todo puesto se pinta como de plantilla: es la realidad
   * de todos los puestos sembrados hasta que exista «duplicar puesto».
   */
  origenPlantilla: boolean;
  tareaEnCurso: TareaDelInicio | null;
  ultimasCompletadas: TareaDelInicio[];
}

export interface AvisoDelInicio {
  aprobacionId: string;
  tareaId: string;
  puestoId: string;
  puesto: string;
  claseAccion: string;
  nivelExigido: string;
  resumenLegible: string;
  creadoEn: string;
}

export interface TareaDeEncargoCreada {
  tareaId: string;
}

export interface DecisionDelInicio {
  decidida: boolean;
  motivo?: string | undefined;
}

/** Lo que la ruta necesita de fuera. Se inyecta para probarla sin base ni Temporal. */
export interface PuertoInicio {
  agentes(tenantId: string): Promise<AgenteDelInicio[]>;
  avisos(tenantId: string, personaId: string): Promise<AvisoDelInicio[]>;
  /** `null` si el puesto no existe en el tenant, no tiene versión activa o no admite trabajo nuevo. */
  puestoAdmiteEncargo(tenantId: string, puestoId: string): Promise<boolean>;
  /** Inserta la tarea, la cuenta, arranca el flujo y avisa a la sala del departamento. */
  crearTareaDeEncargo(
    tenantId: string,
    datos: { puestoId: string; personaId: string; encargo: string },
  ): Promise<TareaDeEncargoCreada>;
  aprobacionParaDecidir(tenantId: string, aprobacionId: string): Promise<AprobacionLeida | null>;
  /** Registra la decisión y entrega la señal al flujo de la tarea (best-effort). */
  decidirAprobacion(
    tenantId: string,
    datos: { aprobacionId: string; personaId: string; sentido: 'aprobada' | 'rechazada' },
  ): Promise<DecisionDelInicio>;
}

export interface PeticionInicio {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo?: unknown;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaContador {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

function campo(cuerpo: unknown, nombre: string): unknown {
  return typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)[nombre]
    : undefined;
}

export async function atenderInicio(
  peticion: PeticionInicio,
  configuracion: ConfiguracionInicio | undefined,
  puerto: PuertoInicio,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaContador | undefined> {
  const [camino = '/'] = (peticion.url ?? '/').split('?');
  if (camino !== PREFIJO_INICIO && !camino.startsWith(`${PREFIJO_INICIO}/`)) return undefined;
  if (!configuracion) return undefined;

  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  const { tenantId, personaId } = sesion;

  if (camino === `${PREFIJO_INICIO}/agentes`) {
    if (peticion.metodo !== 'GET') return respuesta(405, { error: 'Los agentes se leen con GET.' });
    return respuesta(200, { agentes: await puerto.agentes(tenantId) });
  }

  if (camino === `${PREFIJO_INICIO}/avisos`) {
    if (peticion.metodo !== 'GET') return respuesta(405, { error: 'Los avisos se leen con GET.' });
    return respuesta(200, { avisos: await puerto.avisos(tenantId, personaId) });
  }

  if (camino === `${PREFIJO_INICIO}/encargar`) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se encarga con POST.' });
    const encargo = campo(peticion.cuerpo, 'encargo');
    const puestoId = campo(peticion.cuerpo, 'puestoId');
    if (typeof encargo !== 'string' || encargo.trim().length === 0) {
      return respuesta(400, { error: 'Falta el encargo.' });
    }
    if (encargo.length > LONGITUD_MAXIMA_ENCARGO) {
      return respuesta(413, { error: `El encargo pasa de ${LONGITUD_MAXIMA_ENCARGO} caracteres.` });
    }
    if (typeof puestoId !== 'string' || !UUID.test(puestoId)) {
      return respuesta(400, { error: 'Falta el puesto al que encargarlo.' });
    }

    if (!(await puerto.puestoAdmiteEncargo(tenantId, puestoId))) {
      return respuesta(404, {
        error: 'Ese puesto no existe en esta organización o no admite encargos.',
      });
    }

    const { tareaId } = await puerto.crearTareaDeEncargo(tenantId, {
      puestoId,
      personaId,
      encargo: encargo.trim(),
    });
    return respuesta(202, { tareaId });
  }

  const decidir = /^\/inicio\/avisos\/([^/]+)\/decidir$/.exec(camino);
  if (decidir) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se decide con POST.' });
    const aprobacionId = decidir[1] ?? '';
    const sentido = campo(peticion.cuerpo, 'sentido');
    if (!UUID.test(aprobacionId) || (sentido !== 'aprobada' && sentido !== 'rechazada')) {
      return respuesta(400, {
        error: 'Hace falta una aprobación válida y sentido aprobada o rechazada.',
      });
    }

    const aprobacion = await puerto.aprobacionParaDecidir(tenantId, aprobacionId);
    if (!aprobacion) return respuesta(404, { error: 'Esa aprobación no existe.' });
    // Solo decide quien la tiene pedida a su nombre (criterio de hecho): no
    // cualquier aprobación de la organización, aunque la persona tenga sesión.
    if (aprobacion.personaId !== personaId) {
      return respuesta(403, { error: 'Esta aprobación no te la han pedido a ti.' });
    }
    if (aprobacion.decision) {
      // Idempotente: ya está decidida y no se repite (Aprobación por correo v0).
      return respuesta(200, { aprobacionId, yaEstaba: true, sentido: aprobacion.decision.sentido });
    }

    const resultado = await puerto.decidirAprobacion(tenantId, {
      aprobacionId,
      personaId,
      sentido,
    });
    if (!resultado.decidida) {
      return respuesta(409, {
        error: `La aprobación ya no se puede decidir así (${resultado.motivo ?? 'motivo desconocido'}).`,
      });
    }
    return respuesta(200, { aprobacionId, yaEstaba: false, sentido });
  }

  return respuesta(404, { error: 'Esa ruta del inicio no existe.' });
}

/** Puerto real: lecturas y escrituras con el tenant fijado en la transacción. */
export function puertoInicio(
  cliente: postgres.Sql,
  flujos: ClienteDeFlujos,
  configuracion: ConfiguracionInicio,
  /** Cliente HTTP de Centrifugo. Por defecto, `fetch`; las pruebas inyectan el suyo. */
  buscarCentrifugo: BuscadorCentrifugo = fetch as unknown as BuscadorCentrifugo,
): PuertoInicio {
  return {
    async agentes(tenantId) {
      const puestos = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            nombre: string;
            estado: string;
            departamento_id: string;
            departamento: string;
            sala_id: string | null;
          }[]
        >`
          select
            pu.id, pu.nombre, pu.estado::text as estado,
            d.id as departamento_id, d.nombre as departamento,
            s.id as sala_id
          from puesto pu
          join departamento d on d.tenant_id = pu.tenant_id and d.id = pu.departamento_id
          left join sala s on s.tenant_id = pu.tenant_id and s.departamento_id = d.id
          where pu.tenant_id = ${tenantId}
          order by d.nombre, pu.nombre
        `,
      );
      if (puestos.length === 0) return [];
      const puestoIds = puestos.map((p) => p.id);

      const enCurso = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ puesto_id: string; id: string; resultado: unknown; creado_en: Date }[]>`
          select distinct on (puesto_id) puesto_id, id, resultado, creado_en
          from tarea
          where tenant_id = ${tenantId} and puesto_id in ${tx(puestoIds)}
            and estado in ('en_curso', 'esperando_aprobacion')
            and coalesce(tarea_raiz_id, id) = id
          order by puesto_id, creado_en desc
        `,
      );
      const enCursoPorPuesto = new Map(enCurso.map((f) => [f.puesto_id, f]));

      const completadas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            puesto_id: string;
            id: string;
            resultado: unknown;
            estado: string;
            actualizado_en: Date;
          }[]
        >`
          select puesto_id, id, resultado, estado::text as estado, actualizado_en
          from tarea
          where tenant_id = ${tenantId} and puesto_id in ${tx(puestoIds)}
            and estado in ('completada', 'fallida', 'cancelada')
            and coalesce(tarea_raiz_id, id) = id
          order by actualizado_en desc
        `,
      );
      const completadasPorPuesto = new Map<string, (typeof completadas)[number][]>();
      for (const fila of completadas) {
        const lista = completadasPorPuesto.get(fila.puesto_id) ?? [];
        if (lista.length < 3) lista.push(fila);
        completadasPorPuesto.set(fila.puesto_id, lista);
      }

      const encargoDe = (resultado: unknown): string => {
        const valor =
          typeof resultado === 'object' && resultado !== null
            ? (resultado as Record<string, unknown>)['encargo']
            : undefined;
        return typeof valor === 'string' && valor.trim().length > 0 ? valor : 'Sin descripción.';
      };

      return puestos.map((p): AgenteDelInicio => {
        const actual = enCursoPorPuesto.get(p.id);
        const completadasDelPuesto = completadasPorPuesto.get(p.id) ?? [];
        return {
          puestoId: p.id,
          nombre: p.nombre,
          estado: p.estado,
          departamentoId: p.departamento_id,
          departamento: p.departamento,
          salaId: p.sala_id,
          origenPlantilla: true,
          tareaEnCurso: actual
            ? {
                tareaId: actual.id,
                encargo: encargoDe(actual.resultado),
                estado: 'en_curso',
                desde: actual.creado_en.toISOString(),
              }
            : null,
          ultimasCompletadas: completadasDelPuesto.map((f) => ({
            tareaId: f.id,
            encargo: encargoDe(f.resultado),
            estado: f.estado,
            desde: f.actualizado_en.toISOString(),
          })),
        };
      });
    },

    async avisos(tenantId, personaId) {
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            tarea_id: string;
            puesto_id: string;
            puesto: string;
            clase_accion: string;
            nivel_exigido: string;
            resumen_legible: string;
            creado_en: Date;
          }[]
        >`
          select a.id, a.tarea_id, t.puesto_id, pu.nombre as puesto,
            a.clase_accion, a.nivel_exigido::text as nivel_exigido,
            a.resumen_legible, a.creado_en
          from aprobacion a
          join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
          join puesto pu on pu.tenant_id = t.tenant_id and pu.id = t.puesto_id
          left join decision_aprobacion d on d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
          where a.tenant_id = ${tenantId} and a.persona_id = ${personaId} and d.id is null
          order by a.creado_en asc
        `,
      );
      return filas.map((fila) => ({
        aprobacionId: fila.id,
        tareaId: fila.tarea_id,
        puestoId: fila.puesto_id,
        puesto: fila.puesto,
        claseAccion: fila.clase_accion,
        nivelExigido: fila.nivel_exigido,
        resumenLegible: fila.resumen_legible,
        creadoEn: fila.creado_en.toISOString(),
      }));
    },

    async puestoAdmiteEncargo(tenantId, puestoId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ estado: string; tiene_version: boolean }[]>`
          select estado::text as estado, (version_activa_id is not null) as tiene_version
          from puesto
          where tenant_id = ${tenantId} and id = ${puestoId}
        `,
      );
      return fila !== undefined && fila.tiene_version && ESTADOS_QUE_TRABAJAN.has(fila.estado);
    },

    async crearTareaDeEncargo(tenantId, datos) {
      const { tareaId, versionPuestoId, salaId } = await conTenant(
        cliente,
        tenantId,
        async (tx) => {
          const [puesto] = await tx<{ version_activa_id: string; sala_id: string | null }[]>`
            select pu.version_activa_id, s.id as sala_id
            from puesto pu
            left join sala s on s.tenant_id = pu.tenant_id and s.departamento_id = pu.departamento_id
            where pu.tenant_id = ${tenantId} and pu.id = ${datos.puestoId}
          `;
          if (!puesto?.version_activa_id) {
            throw new Error(`El puesto ${datos.puestoId} no tiene versión activa.`);
          }
          const id = uuidV7();
          await tx`
            insert into tarea (
              id, tenant_id, puesto_id, version_puesto_id, origen, estado, resultado
            ) values (
              ${id}, ${tenantId}, ${datos.puestoId}, ${puesto.version_activa_id},
              'manual', 'pendiente', ${JSON.stringify({ encargo: datos.encargo })}::text::jsonb
            )
          `;
          await tx`update tarea set tarea_raiz_id = ${id} where tenant_id = ${tenantId} and id = ${id}`;
          // Cuenta la tarea de inmediato: no espera a que el trabajador arranque el
          // flujo. `registrarTareaRaiz` es idempotente (`packages/ledger`), así que
          // cuando la actividad `arrancarTarea` la cuente otra vez dentro del flujo,
          // no duplica (criterio de hecho 3).
          await registrarTareaRaiz(tx, tenantId, {
            tareaId: id,
            puestoId: datos.puestoId,
            versionPuestoId: puesto.version_activa_id,
            actorTipo: 'persona',
            actorId: datos.personaId,
          });
          return { tareaId: id, versionPuestoId: puesto.version_activa_id, salaId: puesto.sala_id };
        },
      );

      await flujos.arrancar(FLUJO_TAREA_AGENTE, {
        cola: configuracion.temporal.cola,
        id: `inicio-encargo-${tareaId}`,
        args: [
          {
            tenantId,
            puestoId: datos.puestoId,
            versionPuestoId,
            tareaId,
            encargo: datos.encargo,
            validezAprobacionSegundos: VALIDEZ_APROBACION_SEGUNDOS_POR_DEFECTO,
            aprendizaje: false,
          },
        ],
      });

      // Aviso best-effort al canal de Sala v1 del departamento: quien tiene el
      // inicio abierto ve «lo último» sin refrescar. Mismo canal y mismo formato de
      // aviso que ya publica `avisarEscribiendo` en `sala.ts`; sin Centrifugo
      // configurado, o si no responde, el panel sigue vivo por su respaldo de
      // consulta periódica (igual que Sala v1 con Centrifugo caído).
      if (configuracion.centrifugo && salaId) {
        try {
          await publicarEnSala(
            configuracion.centrifugo,
            tenantId,
            salaId,
            { tipo: 'mensaje' },
            buscarCentrifugo,
          );
        } catch {
          // Best-effort: un aviso que no llega no deshace el encargo ya arrancado.
        }
      }

      return { tareaId };
    },

    async aprobacionParaDecidir(tenantId, aprobacionId) {
      return conTenant(cliente, tenantId, (tx) => leerAprobacion(tx, tenantId, aprobacionId));
    },

    async decidirAprobacion(tenantId, datos) {
      const resultado = await registrarDecision(cliente, tenantId, {
        aprobacionId: datos.aprobacionId,
        sentido: datos.sentido,
        personaId: datos.personaId,
        origen: 'panel',
        herramienta: 'inicio',
      });
      if (resultado.estado !== 'registrada') {
        return { decidida: false, motivo: resultado.motivo };
      }
      const flujoId = resultado.aprobacion.flujoTemporalId;
      if (flujoId) {
        try {
          await flujos.senalar(
            flujoId,
            SENAL_DECISION_APROBACION,
            cargaDeSenal(tenantId, resultado.aprobacion, resultado.decision, 'panel'),
          );
        } catch {
          // Best-effort, como el aviso a la sala: la decisión ya está en el libro,
          // y un fallo al entregar la señal no la deshace (igual que en `apps/channels`).
        }
      }
      return { decidida: true };
    },
  };
}
