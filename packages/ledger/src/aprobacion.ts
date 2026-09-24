/**
 * Escritura de aprobaciones y de sus decisiones, pegada al libro de auditoría.
 *
 * Vive en este paquete y no en `apps/channels` por una razón: la decisión y su
 * entrada en el libro se escriben en la misma transacción, o no se escribe ninguna.
 * Si la escritura viviera en la aplicación, «cada decisión emite entrada» sería una
 * costumbre del código que la llama; aquí es una propiedad del módulo que la escribe.
 *
 * `aprobacion` es inmutable: se inserta cuando el agente pide permiso y no se toca
 * más. Resolverla es insertar una fila en `decision_aprobacion`, cuya única por
 * `(tenant_id, aprobacion_id)` es lo que da el «un solo uso» del enlace del correo.
 * La aplicación no comprueba si el enlace ya se usó: lo dice la base cuando el
 * segundo `INSERT` choca, que es la única respuesta fiable con dos clics a la vez.
 */
import { conTenant } from '@aiw/db';
import {
  cargaSenalDecision as esquemaSenalDecision,
  esquemas,
  type CargaSenalDecision,
  type OrigenDecision,
} from '@aiw/domain';
import type postgres from 'postgres';

import { anotar, type EntradaAnotada, type EntradaNueva } from './libro.js';

/**
 * Nombres de acción del libro para esta rebanada, en un solo sitio.
 *
 * Una entrada de auditoría se consulta dentro de seis años y se filtra por este
 * texto: si cada módulo lo escribe a mano, la consulta de auditoría se convierte en
 * una adivinanza. Cambiar uno de estos valores rompe consultas ya escritas, así que
 * se añade, no se renombra.
 */
export const ACCIONES = {
  solicitada: 'aprobacion.solicitada',
  correoEnviado: 'aprobacion.correo.enviado',
  enlaceAbierto: 'aprobacion.enlace.abierto',
  enlaceRechazado: 'aprobacion.enlace.rechazado',
  aprobada: 'aprobacion.aprobada',
  rechazada: 'aprobacion.rechazada',
  vencida: 'aprobacion.vencida',
  senalEntregada: 'aprobacion.senal.entregada',
} as const;

export type AccionAprobacion = (typeof ACCIONES)[keyof typeof ACCIONES];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Código de PostgreSQL para la violación de una restricción de unicidad. */
const UNICIDAD_VIOLADA = '23505';

function esUuid(valor: string): boolean {
  return UUID.test(valor);
}

function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNICIDAD_VIOLADA
  );
}

/** Lo que el agente pide aprobar. El borrador es opaco y no se interpreta aquí. */
export interface SolicitudDeAprobacion {
  tareaId: string;
  pasoId?: string | null | undefined;
  /** A quién se le pide. Quién decide de verdad queda en la fila de la decisión. */
  personaId?: string | null | undefined;
  claseAccion: string;
  nivelExigido: 'n0' | 'n1' | 'n2' | 'n3';
  borradorOpaco: esquemas.BorradorOpaco;
  resumenLegible: string;
  venceEn?: Date | null | undefined;
}

export interface AprobacionSolicitada {
  id: string;
  creadoEn: Date;
  venceEn: Date | null;
  entrada: EntradaAnotada;
}

/** Contexto de la tarea que hace falta para anotar y para señalar al flujo. */
interface ContextoTarea {
  puesto_id: string;
  version_puesto_id: string;
  flujo_temporal_id: string | null;
}

async function leerContextoTarea(
  tx: postgres.TransactionSql,
  tenantId: string,
  tareaId: string,
): Promise<ContextoTarea> {
  const [tarea] = await tx<ContextoTarea[]>`
    select puesto_id, version_puesto_id, flujo_temporal_id
    from tarea
    where tenant_id = ${tenantId} and id = ${tareaId}
  `;
  if (!tarea) throw new Error(`La tarea ${tareaId} no existe en este tenant.`);
  return tarea;
}

/**
 * Inserta la aprobación y la anota. Se llama dentro de `conTenant`, en la misma
 * transacción que el paso del agente que necesitaba el permiso.
 */
export async function solicitarAprobacion(
  tx: postgres.TransactionSql,
  tenantId: string,
  solicitud: SolicitudDeAprobacion,
): Promise<AprobacionSolicitada> {
  if (solicitud.resumenLegible.trim().length === 0) {
    throw new Error('Una aprobación sin resumen legible no se puede aprobar a ciegas.');
  }
  // La columna es `jsonb`: pasa por su esquema antes de tocar la base, igual que en
  // el punto único de escritura del libro.
  const borrador = esquemas.validarCarga(
    esquemas.borradorOpaco,
    solicitud.borradorOpaco,
    'aprobacion.borrador_opaco',
  );
  const tarea = await leerContextoTarea(tx, tenantId, solicitud.tareaId);

  const [fila] = await tx<{ id: string; creado_en: Date; vence_en: Date | null }[]>`
    insert into aprobacion (
      tenant_id, tarea_id, paso_id, persona_id, clase_accion, nivel_exigido,
      borrador_opaco, resumen_legible, vence_en
    ) values (
      ${tenantId}, ${solicitud.tareaId}, ${solicitud.pasoId ?? null},
      ${solicitud.personaId ?? null}, ${solicitud.claseAccion}, ${solicitud.nivelExigido},
      ${JSON.stringify(borrador)}::text::jsonb, ${solicitud.resumenLegible},
      ${solicitud.venceEn ?? null}
    )
    returning id, creado_en, vence_en
  `;
  if (!fila) throw new Error('La aprobación no se insertó.');

  const entrada = await anotar(tx, tenantId, {
    actorTipo: 'agente',
    puestoId: tarea.puesto_id,
    versionPuestoId: tarea.version_puesto_id,
    tareaId: solicitud.tareaId,
    pasoId: solicitud.pasoId ?? null,
    accion: ACCIONES.solicitada,
    datosReferenciados: [
      { tipo: 'aprobacion', id: fila.id },
      { tipo: 'clase_accion', id: solicitud.claseAccion },
    ],
    resultado: 'exito',
    nivelAplicado: solicitud.nivelExigido,
  });

  return { id: fila.id, creadoEn: fila.creado_en, venceEn: fila.vence_en, entrada };
}

export interface DecisionRegistrada {
  id: string;
  sentido: esquemas.SentidoDecision;
  personaId: string | null;
  creadoEn: Date;
}

/** La aprobación con lo que hace falta para decidirla y para señalar al flujo. */
export interface AprobacionLeida {
  id: string;
  tareaId: string;
  pasoId: string | null;
  personaId: string | null;
  claseAccion: string;
  nivelExigido: 'n0' | 'n1' | 'n2' | 'n3';
  resumenLegible: string;
  venceEn: Date | null;
  creadoEn: Date;
  puestoId: string;
  versionPuestoId: string;
  flujoTemporalId: string | null;
  decision: DecisionRegistrada | null;
}

interface FilaAprobacion {
  id: string;
  tarea_id: string;
  paso_id: string | null;
  persona_id: string | null;
  clase_accion: string;
  nivel_exigido: 'n0' | 'n1' | 'n2' | 'n3';
  resumen_legible: string;
  vence_en: Date | null;
  creado_en: Date;
  puesto_id: string;
  version_puesto_id: string;
  flujo_temporal_id: string | null;
  decision_id: string | null;
  decision_sentido: esquemas.SentidoDecision | null;
  decision_persona_id: string | null;
  decision_creado_en: Date | null;
}

/**
 * Lee la aprobación, su tarea y su decisión si la tiene.
 *
 * Devuelve `null` cuando no existe, cuando es de otro tenant —la política de RLS no
 * la deja ver, que es la misma respuesta— o cuando el identificador no es un UUID.
 * Quien pregunta no distingue los tres casos, y eso es deliberado: la página de
 * aprobación es genérica y no revela si una aprobación existe.
 */
export async function leerAprobacion(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  aprobacionId: string,
): Promise<AprobacionLeida | null> {
  if (!esUuid(aprobacionId) || !esUuid(tenantId)) return null;

  const [fila] = await tx<FilaAprobacion[]>`
    select
      a.id, a.tarea_id, a.paso_id, a.persona_id, a.clase_accion, a.nivel_exigido,
      a.resumen_legible, a.vence_en, a.creado_en,
      t.puesto_id, t.version_puesto_id, t.flujo_temporal_id,
      d.id as decision_id, d.sentido as decision_sentido,
      d.persona_id as decision_persona_id, d.creado_en as decision_creado_en
    from aprobacion a
    join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
    left join decision_aprobacion d
      on d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
    where a.tenant_id = ${tenantId} and a.id = ${aprobacionId}
  `;
  if (!fila) return null;

  return {
    id: fila.id,
    tareaId: fila.tarea_id,
    pasoId: fila.paso_id,
    personaId: fila.persona_id,
    claseAccion: fila.clase_accion,
    nivelExigido: fila.nivel_exigido,
    resumenLegible: fila.resumen_legible,
    venceEn: fila.vence_en,
    creadoEn: fila.creado_en,
    puestoId: fila.puesto_id,
    versionPuestoId: fila.version_puesto_id,
    flujoTemporalId: fila.flujo_temporal_id,
    decision:
      fila.decision_id && fila.decision_sentido && fila.decision_creado_en
        ? {
            id: fila.decision_id,
            sentido: fila.decision_sentido,
            personaId: fila.decision_persona_id,
            creadoEn: fila.decision_creado_en,
          }
        : null,
  };
}

/** Motivo por el que la plataforma se niega a atender un enlace. Se anota tal cual. */
export type MotivoRechazoEnlace = 'ya_decidida' | 'vencida' | 'no_encontrada';

export type ResultadoDecision =
  | { estado: 'registrada'; decision: DecisionRegistrada; aprobacion: AprobacionLeida }
  | {
      estado: 'rechazada_por_enlace';
      motivo: MotivoRechazoEnlace;
      decisionPrevia: DecisionRegistrada | null;
      aprobacion: AprobacionLeida | null;
    };

export interface PeticionDeDecision {
  aprobacionId: string;
  /** Viene del token firmado. Sirve para atribuir la entrada aunque no haya fila. */
  tareaId?: string | null | undefined;
  sentido: esquemas.SentidoDecision;
  /**
   * Quién decide. Sin valor, la persona a la que se le pidió la aprobación: el
   * enlace del correo es personal y de un solo uso, así que quien lo usa es quien
   * lo recibió. `null` significa que decide la plataforma, y eso solo pasa por
   * vencimiento o por política.
   */
  personaId?: string | null | undefined;
  motivo?: string | null | undefined;
  origen: OrigenDecision;
  herramienta?: string | null | undefined;
  ahora?: Date | undefined;
}

/**
 * Registra la decisión de una aprobación, o explica por qué no.
 *
 * Toma el cliente y no una transacción porque necesita más de una: cuando el
 * `INSERT` de la decisión choca con la única, la transacción queda abortada y ya no
 * se puede anotar nada dentro de ella. Cada rama abre la suya, y en todas se anota:
 * el intento de reutilizar un enlace es información de auditoría, no un error que
 * se traga el servidor.
 */
export async function registrarDecision(
  cliente: postgres.Sql,
  tenantId: string,
  peticion: PeticionDeDecision,
): Promise<ResultadoDecision> {
  const ahora = peticion.ahora ?? new Date();
  const leida = await conTenant(cliente, tenantId, (tx) =>
    leerAprobacion(tx, tenantId, peticion.aprobacionId),
  );

  if (!leida) {
    await anotarEnlaceRechazado(cliente, tenantId, {
      aprobacionId: peticion.aprobacionId,
      tareaId: peticion.tareaId,
      origen: peticion.origen,
      herramienta: peticion.herramienta,
      motivo: 'no_encontrada',
    });
    return {
      estado: 'rechazada_por_enlace',
      motivo: 'no_encontrada',
      decisionPrevia: null,
      aprobacion: null,
    };
  }
  if (leida.decision) {
    await anotarEnlaceRechazado(cliente, tenantId, {
      aprobacionId: peticion.aprobacionId,
      origen: peticion.origen,
      herramienta: peticion.herramienta,
      motivo: 'ya_decidida',
      aprobacion: leida,
    });
    return {
      estado: 'rechazada_por_enlace',
      motivo: 'ya_decidida',
      decisionPrevia: leida.decision,
      aprobacion: leida,
    };
  }
  if (leida.venceEn && leida.venceEn.getTime() <= ahora.getTime()) {
    await anotarEnlaceRechazado(cliente, tenantId, {
      aprobacionId: peticion.aprobacionId,
      origen: peticion.origen,
      herramienta: peticion.herramienta,
      motivo: 'vencida',
      aprobacion: leida,
    });
    return {
      estado: 'rechazada_por_enlace',
      motivo: 'vencida',
      decisionPrevia: null,
      aprobacion: leida,
    };
  }

  // El enlace es personal y de un solo uso: sin persona explícita, decide quien lo
  // recibió. `null` explícito es la plataforma, y eso no llega nunca desde un enlace.
  const decisor = peticion.personaId === undefined ? leida.personaId : peticion.personaId;

  try {
    const decision = await conTenant(cliente, tenantId, async (tx) => {
      const insertada = await insertarDecision(tx, tenantId, {
        aprobacionId: leida.id,
        personaId: decisor,
        sentido: peticion.sentido,
        motivo: peticion.motivo ?? null,
      });
      await anotar(tx, tenantId, {
        actorTipo: 'persona',
        actorId: decisor,
        puestoId: leida.puestoId,
        versionPuestoId: leida.versionPuestoId,
        tareaId: leida.tareaId,
        pasoId: leida.pasoId,
        accion: peticion.sentido === 'rechazada' ? ACCIONES.rechazada : ACCIONES.aprobada,
        herramienta: peticion.herramienta ?? peticion.origen,
        datosReferenciados: [
          { tipo: 'aprobacion', id: leida.id },
          { tipo: 'decision_aprobacion', id: insertada.id },
          { tipo: 'clase_accion', id: leida.claseAccion },
        ],
        resultado: 'exito',
        // El nombre de la columna habla de aprobar: solo se rellena cuando de
        // verdad alguien autorizó la acción. En un rechazo nadie autorizó nada, y
        // quién decidió está en `actor_id` y en la fila de la decisión.
        aprobadaPorPersonaId: peticion.sentido === 'aprobada' ? decisor : null,
        nivelAplicado: leida.nivelExigido,
      });
      return insertada;
    });
    return { estado: 'registrada', decision, aprobacion: leida };
  } catch (error) {
    if (!esViolacionDeUnicidad(error)) throw error;
    // Dos clics a la vez: el otro llegó primero. No es un error para quien pulsó.
    const relectura = await conTenant(cliente, tenantId, (tx) =>
      leerAprobacion(tx, tenantId, peticion.aprobacionId),
    );
    await anotarEnlaceRechazado(cliente, tenantId, {
      aprobacionId: peticion.aprobacionId,
      tareaId: peticion.tareaId,
      origen: peticion.origen,
      herramienta: peticion.herramienta,
      motivo: 'ya_decidida',
      aprobacion: relectura,
    });
    return {
      estado: 'rechazada_por_enlace',
      motivo: 'ya_decidida',
      decisionPrevia: relectura?.decision ?? null,
      aprobacion: relectura,
    };
  }
}

interface DecisionNueva {
  aprobacionId: string;
  personaId: string | null;
  sentido: esquemas.SentidoDecision;
  motivo: string | null;
  edicionPrevia?: unknown;
}

async function insertarDecision(
  tx: postgres.TransactionSql,
  tenantId: string,
  decision: DecisionNueva,
): Promise<DecisionRegistrada> {
  const edicionPrevia =
    decision.edicionPrevia === undefined || decision.edicionPrevia === null
      ? null
      : JSON.stringify(decision.edicionPrevia);
  const [fila] = await tx<{ id: string; creado_en: Date }[]>`
    insert into decision_aprobacion (
      tenant_id, aprobacion_id, persona_id, sentido, motivo, edicion_previa
    ) values (
      ${tenantId}, ${decision.aprobacionId}, ${decision.personaId},
      ${decision.sentido}, ${decision.motivo}, ${edicionPrevia}::text::jsonb
    )
    returning id, creado_en
  `;
  if (!fila) throw new Error('La decisión de la aprobación no se insertó.');
  return {
    id: fila.id,
    sentido: decision.sentido,
    personaId: decision.personaId,
    creadoEn: fila.creado_en,
  };
}

export interface RechazoDeEnlace {
  aprobacionId: string;
  motivo: MotivoRechazoEnlace;
  origen: OrigenDecision;
  /** La aprobación, si se pudo leer. Sin ella, la entrada va con lo que haya. */
  aprobacion?: AprobacionLeida | null | undefined;
  /** Del token firmado, cuando no hay fila que leer. */
  tareaId?: string | null | undefined;
  herramienta?: string | null | undefined;
}

/**
 * Anota que la plataforma se negó a atender un enlace, y por qué.
 *
 * Solo se llama con un token cuya firma ya verificó. Un token con la firma mal no
 * se anota en ninguna cadena: no hay tenant al que atribuirlo sin creerle al
 * atacante en qué libro escribir, y eso convertiría el libro de auditoría en un
 * buzón que cualquiera puede rellenar desde fuera.
 */
export async function anotarEnlaceRechazado(
  cliente: postgres.Sql,
  tenantId: string,
  rechazo: RechazoDeEnlace,
): Promise<EntradaAnotada> {
  const aprobacion = rechazo.aprobacion ?? null;
  const entrada: EntradaNueva = {
    actorTipo: 'persona',
    actorId: aprobacion?.personaId ?? null,
    puestoId: aprobacion?.puestoId ?? null,
    versionPuestoId: aprobacion?.versionPuestoId ?? null,
    tareaId: aprobacion?.tareaId ?? rechazo.tareaId ?? null,
    pasoId: aprobacion?.pasoId ?? null,
    accion: ACCIONES.enlaceRechazado,
    herramienta: rechazo.herramienta ?? rechazo.origen,
    datosReferenciados: [
      { tipo: 'aprobacion', id: rechazo.aprobacionId },
      { tipo: 'motivo', id: rechazo.motivo },
    ],
    resultado: 'rechazado',
    ...(aprobacion ? { nivelAplicado: aprobacion.nivelExigido } : {}),
  };
  return conTenant(cliente, tenantId, (tx) => anotar(tx, tenantId, entrada));
}

/** Registra que alguien abrió el enlace y vio el resumen. Ver no decide nada. */
export async function anotarEnlaceAbierto(
  cliente: postgres.Sql,
  tenantId: string,
  aprobacion: AprobacionLeida,
): Promise<EntradaAnotada> {
  return conTenant(cliente, tenantId, (tx) =>
    anotar(tx, tenantId, {
      actorTipo: 'persona',
      actorId: aprobacion.personaId,
      puestoId: aprobacion.puestoId,
      versionPuestoId: aprobacion.versionPuestoId,
      tareaId: aprobacion.tareaId,
      pasoId: aprobacion.pasoId,
      accion: ACCIONES.enlaceAbierto,
      herramienta: 'correo',
      datosReferenciados: [{ tipo: 'aprobacion', id: aprobacion.id }],
      resultado: 'exito',
      nivelAplicado: aprobacion.nivelExigido,
    }),
  );
}

export interface IntentoDeEnvio {
  aprobacion: AprobacionLeida;
  /** Número de intento, empezando en 1. Un reintento es otra entrada, no un retoque. */
  intento: number;
  proveedor: string;
  duracionMs: number;
  /** Identificador que dio el proveedor, si llegó a darlo. */
  referencia?: string | null | undefined;
  error?: string | null | undefined;
}

/**
 * Anota un intento de envío del correo. Uno por intento, con su resultado.
 *
 * El texto del error se recorta: un error de SMTP puede arrastrar la respuesta
 * entera del servidor, y el libro no es el sitio para volcarla.
 */
export async function anotarCorreoEnviado(
  cliente: postgres.Sql,
  tenantId: string,
  intento: IntentoDeEnvio,
): Promise<EntradaAnotada> {
  const referencias = [
    { tipo: 'aprobacion', id: intento.aprobacion.id },
    { tipo: 'intento', id: String(intento.intento) },
    { tipo: 'proveedor_correo', id: intento.proveedor },
  ];
  if (intento.referencia) referencias.push({ tipo: 'correo', id: intento.referencia });
  if (intento.error) referencias.push({ tipo: 'error', id: recortar(intento.error) });

  return conTenant(cliente, tenantId, (tx) =>
    anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: intento.aprobacion.puestoId,
      versionPuestoId: intento.aprobacion.versionPuestoId,
      tareaId: intento.aprobacion.tareaId,
      pasoId: intento.aprobacion.pasoId,
      accion: ACCIONES.correoEnviado,
      herramienta: 'correo',
      datosReferenciados: referencias,
      resultado: intento.error ? 'error' : 'exito',
      duracionMs: intento.duracionMs,
      nivelAplicado: intento.aprobacion.nivelExigido,
    }),
  );
}

export interface IntentoDeSenal {
  aprobacion: AprobacionLeida;
  intento: number;
  /** Vacío cuando la tarea no tiene flujo: entonces no hay a quién señalar. */
  flujoId: string;
  nombreSenal: string;
  duracionMs: number;
  error?: string | null | undefined;
}

/** Anota un intento de entregar la señal al flujo. Uno por intento. */
export async function anotarSenalEntregada(
  cliente: postgres.Sql,
  tenantId: string,
  intento: IntentoDeSenal,
): Promise<EntradaAnotada> {
  const referencias = [
    { tipo: 'aprobacion', id: intento.aprobacion.id },
    { tipo: 'senal', id: intento.nombreSenal },
    { tipo: 'intento', id: String(intento.intento) },
  ];
  // Una referencia con identificador vacío no sirve para reconstruir nada, y el
  // esquema de la carga la rechaza: si no hay flujo, no se referencia ninguno.
  if (intento.flujoId.length > 0) {
    referencias.push({ tipo: 'flujo_temporal', id: intento.flujoId });
  }
  if (intento.error) referencias.push({ tipo: 'error', id: recortar(intento.error) });

  return conTenant(cliente, tenantId, (tx) =>
    anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: intento.aprobacion.puestoId,
      versionPuestoId: intento.aprobacion.versionPuestoId,
      tareaId: intento.aprobacion.tareaId,
      pasoId: intento.aprobacion.pasoId,
      accion: ACCIONES.senalEntregada,
      herramienta: 'temporal',
      datosReferenciados: referencias,
      resultado: intento.error ? 'error' : 'exito',
      duracionMs: intento.duracionMs,
      nivelAplicado: intento.aprobacion.nivelExigido,
    }),
  );
}

export interface AprobacionVencida {
  aprobacion: AprobacionLeida;
  decision: DecisionRegistrada;
  carga: CargaSenalDecision;
}

export interface OpcionesVencimiento {
  ahora?: Date | undefined;
  /** Cuántas resolver por pasada. La rutina que la llame irá paginando. */
  limite?: number | undefined;
  motivo?: string | undefined;
  /**
   * Solo esta aprobación. Es lo que usa un flujo que venció la suya esperando: la
   * resuelve igual que la rutina —persona nula, `aprobacion.vencida`— sin tocar las
   * de las demás tareas.
   */
  aprobacionId?: string | undefined;
}

/**
 * Resuelve las aprobaciones vencidas sin decisión.
 *
 * La plataforma decide en nombre de nadie: la fila de la decisión lleva
 * `persona_id` nulo, que es exactamente lo que el modelo reserva para «la resolvió
 * la plataforma por vencimiento o política». Sin esto, un flujo que espera una
 * aprobación que nadie abrió espera para siempre.
 *
 * Es idempotente: una aprobación que ya tiene decisión no aparece en la consulta, y
 * si aparece por una carrera, el choque con la única se ignora.
 */
export async function vencerAprobaciones(
  cliente: postgres.Sql,
  tenantId: string,
  opciones: OpcionesVencimiento = {},
): Promise<AprobacionVencida[]> {
  const ahora = opciones.ahora ?? new Date();
  const limite = opciones.limite ?? 100;
  const motivo = opciones.motivo ?? 'Vencida sin respuesta de la persona';

  const pendientes = await conTenant(cliente, tenantId, async (tx) => {
    const soloEsta =
      opciones.aprobacionId === undefined ? tx`` : tx`and a.id = ${opciones.aprobacionId}`;
    return tx<{ id: string }[]>`
      select a.id
      from aprobacion a
      where a.tenant_id = ${tenantId}
        and a.vence_en is not null
        and a.vence_en <= ${ahora}
        ${soloEsta}
        and not exists (
          select 1 from decision_aprobacion d
          where d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
        )
      order by a.vence_en asc
      limit ${limite}
    `;
  });

  const vencidas: AprobacionVencida[] = [];
  for (const pendiente of pendientes) {
    const resuelta = await vencerUna(cliente, tenantId, pendiente.id, motivo);
    if (resuelta) vencidas.push(resuelta);
  }
  return vencidas;
}

async function vencerUna(
  cliente: postgres.Sql,
  tenantId: string,
  aprobacionId: string,
  motivo: string,
): Promise<AprobacionVencida | null> {
  try {
    return await conTenant(cliente, tenantId, async (tx) => {
      const leida = await leerAprobacion(tx, tenantId, aprobacionId);
      if (!leida || leida.decision) return null;

      const decision = await insertarDecision(tx, tenantId, {
        aprobacionId: leida.id,
        personaId: null,
        sentido: 'rechazada',
        motivo,
      });
      await anotar(tx, tenantId, {
        actorTipo: 'plataforma',
        puestoId: leida.puestoId,
        versionPuestoId: leida.versionPuestoId,
        tareaId: leida.tareaId,
        pasoId: leida.pasoId,
        accion: ACCIONES.vencida,
        datosReferenciados: [
          { tipo: 'aprobacion', id: leida.id },
          { tipo: 'decision_aprobacion', id: decision.id },
          { tipo: 'clase_accion', id: leida.claseAccion },
        ],
        resultado: 'exito',
        nivelAplicado: leida.nivelExigido,
      });

      return {
        aprobacion: leida,
        decision,
        carga: cargaDeSenal(tenantId, leida, decision, 'plataforma', motivo),
      };
    });
  } catch (error) {
    if (esViolacionDeUnicidad(error)) return null;
    throw error;
  }
}

/** Compone la carga de la señal. Solo identificadores: el borrador no viaja. */
export function cargaDeSenal(
  tenantId: string,
  aprobacion: AprobacionLeida,
  decision: DecisionRegistrada,
  origen: OrigenDecision,
  motivo?: string | null | undefined,
): CargaSenalDecision {
  return esquemas.validarCarga(
    // Se valida al construirla y no al entregarla: si la carga no cumple el
    // contrato, el fallo sale aquí y no en el flujo, seis saltos más allá.
    esquemaSenalDecision,
    {
      tenantId,
      aprobacionId: aprobacion.id,
      tareaId: aprobacion.tareaId,
      decisionId: decision.id,
      sentido: decision.sentido,
      origen,
      personaId: decision.personaId,
      ...(motivo ? { motivo } : {}),
      decididaEn: decision.creadoEn.toISOString(),
    },
    'senal.decision_aprobacion',
  );
}

function recortar(texto: string, maximo = 200): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}
