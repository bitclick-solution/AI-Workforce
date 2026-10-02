/**
 * Las operaciones del aprendizaje v0 contra PostgreSQL: señal, lección, promoción y
 * reversión.
 *
 * Zona crítica: promociones del aprendizaje y versión de puesto. Cada operación
 * escribe su cambio y su entrada en el libro en la misma transacción (`anotar` suma
 * al contador), así que o quedan las dos cosas o no queda ninguna.
 *
 * Nada de esto actualiza en sitio lo que es inmutable (ADR-007): `senal`, `leccion`,
 * `promocion` y `version_puesto` solo reciben `INSERT`. El estado de una lección se
 * deriva: promocionada es «tiene promoción», vigente es «está en la versión activa».
 * Lo único que cambia es el puntero `puesto.version_activa_id`, que es mutable a
 * propósito y deja rastro en el libro cada vez que se mueve.
 */
import { conTenant } from '@aiw/db';
import { esquemas } from '@aiw/domain';
import { anotar } from '@aiw/ledger';
import type postgres from 'postgres';

import {
  ACCIONES_APRENDIZAJE,
  ErrorDeAprendizaje,
  ORIGEN_EDICION,
  UUID,
  bloquear,
  claveDeMemoria,
  esViolacionDeUnicidad,
  exigirUuid,
  json,
  type CodigoErrorAprendizaje,
} from './comun.js';
import { sanearValor } from './datos-personales.js';
import { diferenciaDeBorradores, type Cambio } from './diferencia.js';
import { leerHabilidadesCongeladas } from './habilidades.js';
import { redactarLeccion, type AmbitoDeLeccion } from './leccion.js';

export {
  ACCIONES_APRENDIZAJE,
  ErrorDeAprendizaje,
  ORIGEN_EDICION,
  claveDeMemoria,
  type CodigoErrorAprendizaje,
};

// ---------------------------------------------------------------------------
// Lectura de la edición
// ---------------------------------------------------------------------------

export interface EdicionLeida {
  aprobacionId: string;
  decisionId: string;
  personaId: string | null;
  tareaId: string;
  puestoId: string;
  versionPuestoId: string;
  claseAccion: string;
  tipoBorrador: string;
  edicion: esquemas.EdicionBorrador;
}

/**
 * Lee la edición de una aprobación decidida como `editada`, o `null` si la
 * aprobación no existe, no está decidida o se decidió de otra forma.
 */
export async function leerEdicion(
  tx: postgres.TransactionSql,
  tenantId: string,
  aprobacionId: string,
): Promise<EdicionLeida | null> {
  if (!UUID.test(aprobacionId)) return null;
  const [fila] = await tx<
    {
      aprobacion_id: string;
      decision_id: string;
      persona_id: string | null;
      tarea_id: string;
      puesto_id: string;
      version_puesto_id: string;
      clase_accion: string;
      tipo_borrador: string | null;
      sentido: esquemas.SentidoDecision;
      edicion_previa: unknown;
    }[]
  >`
    select a.id as aprobacion_id, d.id as decision_id, d.persona_id, a.tarea_id,
      t.puesto_id, t.version_puesto_id, a.clase_accion,
      a.borrador_opaco->>'tipo' as tipo_borrador, d.sentido, d.edicion_previa
    from aprobacion a
    join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
    join decision_aprobacion d on d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
    where a.tenant_id = ${tenantId} and a.id = ${aprobacionId}
  `;
  if (!fila || fila.sentido !== 'editada') return null;
  return {
    aprobacionId: fila.aprobacion_id,
    decisionId: fila.decision_id,
    personaId: fila.persona_id,
    tareaId: fila.tarea_id,
    puestoId: fila.puesto_id,
    versionPuestoId: fila.version_puesto_id,
    claseAccion: fila.clase_accion,
    tipoBorrador: fila.tipo_borrador ?? 'borrador',
    edicion: esquemas.validarCarga(
      esquemas.edicionBorrador,
      fila.edicion_previa,
      'decision_aprobacion.edicion_previa',
    ),
  };
}

// ---------------------------------------------------------------------------
// Señal
// ---------------------------------------------------------------------------

export interface SenalRegistrada {
  senalId: string;
  /**
   * Parte de la clave primaria: `senal` está particionada por mes. Viaja como texto
   * y no como `Date` porque la base guarda microsegundos y `Date` solo milisegundos:
   * con `Date`, la señal dejaría de encontrarse por su propia clave.
   */
  senalCreadoEn: string;
  puestoId: string;
  versionPuestoId: string;
  tareaId: string;
  /** Falso cuando la señal ya existía: la operación es idempotente por aprobación. */
  nueva: boolean;
}

interface DetalleDeEdicion {
  aprobacionId: string;
  decisionId: string;
  tipoBorrador: string;
  claseAccion: string;
  cambios: Cambio[];
  datosPersonalesQuitados: string[];
}

/**
 * Convierte la edición de una aprobación en una señal `correccion`.
 *
 * La señal guarda la diferencia por rutas ya saneada, no el borrador entero: la
 * edición completa sigue en `decision_aprobacion.edicion_previa` para quien tenga
 * que auditarla, y la señal solo lleva lo que el aprendizaje necesita.
 */
export async function registrarSenalDeEdicion(
  cliente: postgres.Sql,
  tenantId: string,
  aprobacionId: string,
): Promise<SenalRegistrada> {
  exigirUuid(tenantId, 'tenantId');
  return conTenant(cliente, tenantId, async (tx) => {
    await bloquear(tx, `senal:${aprobacionId}`);
    const edicion = await leerEdicion(tx, tenantId, aprobacionId);
    if (!edicion) {
      throw new ErrorDeAprendizaje(
        'no_es_edicion',
        `La aprobación ${aprobacionId} no existe o no se decidió como «editada».`,
      );
    }

    const [previa] = await tx<{ id: string; creado_en: string }[]>`
      select id, creado_en::text as creado_en from senal
      where tenant_id = ${tenantId} and aprobacion_id = ${aprobacionId} and origen = ${ORIGEN_EDICION}
      order by creado_en limit 1
    `;
    if (previa) {
      return {
        senalId: previa.id,
        senalCreadoEn: previa.creado_en,
        puestoId: edicion.puestoId,
        versionPuestoId: edicion.versionPuestoId,
        tareaId: edicion.tareaId,
        nueva: false,
      };
    }

    const cambios = diferenciaDeBorradores(edicion.edicion.antes, edicion.edicion.despues);
    if (cambios.length === 0) {
      throw new ErrorDeAprendizaje(
        'sin_cambios',
        `La edición de ${aprobacionId} es idéntica al borrador: no hay nada que aprender.`,
      );
    }
    const saneados = sanearValor(cambios);
    const detalle: DetalleDeEdicion = {
      aprobacionId,
      decisionId: edicion.decisionId,
      tipoBorrador: edicion.tipoBorrador,
      claseAccion: edicion.claseAccion,
      cambios: saneados.valor as Cambio[],
      datosPersonalesQuitados: saneados.hallados,
    };
    const contenido = esquemas.validarCarga(
      esquemas.contenidoSenal,
      {
        resumen: `La persona editó ${edicion.tipoBorrador} antes de aprobarlo (${cambios.length} cambio${cambios.length === 1 ? '' : 's'}).`,
        detalle,
        puntuacion: -0.3,
      },
      'senal.contenido',
    );

    const [fila] = await tx<{ id: string; creado_en: string }[]>`
      insert into senal (tenant_id, puesto_id, tipo, origen, aprobacion_id, tarea_id, contenido)
      values (
        ${tenantId}, ${edicion.puestoId}, 'correccion', ${ORIGEN_EDICION},
        ${aprobacionId}, ${edicion.tareaId}, ${json(contenido)}::text::jsonb
      )
      returning id, creado_en::text as creado_en
    `;
    if (!fila) throw new Error('La señal de la edición no se insertó.');

    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: edicion.puestoId,
      versionPuestoId: edicion.versionPuestoId,
      tareaId: edicion.tareaId,
      accion: ACCIONES_APRENDIZAJE.senalRegistrada,
      datosReferenciados: [
        { tipo: 'senal', id: fila.id },
        { tipo: 'aprobacion', id: aprobacionId },
        { tipo: 'decision_aprobacion', id: edicion.decisionId },
      ],
      resultado: 'exito',
    });

    return {
      senalId: fila.id,
      senalCreadoEn: fila.creado_en,
      puestoId: edicion.puestoId,
      versionPuestoId: edicion.versionPuestoId,
      tareaId: edicion.tareaId,
      nueva: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Lección
// ---------------------------------------------------------------------------

export interface LeccionPropuesta {
  leccionId: string;
  puestoId: string;
  /** A quién enseña: al puesto de la señal o a todos los de su departamento. */
  ambito: AmbitoDeLeccion;
  titulo: string;
  linea: string;
  /** Falso cuando la lección de esa señal ya existía. */
  nueva: boolean;
}

export interface OpcionesDeLeccion {
  /** Por defecto, `puesto`. Con `departamento` la lección acaba en la memoria compartida. */
  ambito?: AmbitoDeLeccion | undefined;
  /**
   * Marca el contenido como categoría especial (salud, ideología, afiliación…). Quien
   * propone es quien lo clasifica; la puerta del Evaluador bloquea una lección de
   * departamento marcada, y la memoria no la guarda nunca (decisión 6 de la
   * especificación del supervisor de departamento).
   */
  categoriaEspecial?: boolean | undefined;
}

/**
 * Propone la lección de memoria de una señal de edición. Queda en `propuesta` hasta
 * que una persona la promociona: en v0 no hay promoción automática.
 *
 * Con `ambito: 'departamento'` la lección es la misma, pero sus parámetros llevan
 * `destino: 'departamento'` y su promoción deja una versión en cada puesto del
 * departamento del puesto que originó la señal.
 */
export async function proponerLeccion(
  cliente: postgres.Sql,
  tenantId: string,
  senal: { senalId: string; senalCreadoEn: string },
  opciones: OpcionesDeLeccion = {},
): Promise<LeccionPropuesta> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(senal.senalId, 'senalId');
  return conTenant(cliente, tenantId, async (tx) => {
    await bloquear(tx, `leccion:${senal.senalId}`);

    const [previa] = await tx<
      { id: string; puesto_id: string; titulo: string; parametros: { valor?: unknown } }[]
    >`
      select l.id, l.puesto_id, l.titulo, l.parametros
      from leccion_senal ls
      join leccion l on l.tenant_id = ls.tenant_id and l.id = ls.leccion_id
      where ls.tenant_id = ${tenantId} and ls.senal_id = ${senal.senalId}
      limit 1
    `;
    if (previa) {
      return {
        leccionId: previa.id,
        puestoId: previa.puesto_id,
        ambito:
          (previa.parametros as { destino?: unknown }).destino === 'departamento'
            ? 'departamento'
            : 'puesto',
        titulo: previa.titulo,
        linea: String(previa.parametros.valor ?? ''),
        nueva: false,
      };
    }

    const [fila] = await tx<
      {
        id: string;
        creado_en: string;
        puesto_id: string;
        tarea_id: string | null;
        origen: string;
        contenido: { detalle?: Partial<DetalleDeEdicion> };
      }[]
    >`
      select id, creado_en::text as creado_en, puesto_id, tarea_id, origen, contenido from senal
      where tenant_id = ${tenantId} and id = ${senal.senalId}
        and creado_en = ${senal.senalCreadoEn}::text::timestamptz
    `;
    if (!fila) {
      throw new ErrorDeAprendizaje(
        'no_encontrada',
        `No hay señal ${senal.senalId} en este tenant.`,
      );
    }
    if (fila.origen !== ORIGEN_EDICION) {
      throw new ErrorDeAprendizaje(
        'no_es_edicion',
        `La señal ${senal.senalId} viene de «${fila.origen}»: v0 solo aprende de ediciones.`,
      );
    }

    const detalle = fila.contenido.detalle ?? {};
    const redactada = redactarLeccion(detalle.cambios ?? [], {
      tipoBorrador: detalle.tipoBorrador ?? 'borrador',
      claseAccion: detalle.claseAccion ?? 'desconocida',
      ambito: opciones.ambito,
    });

    const contenido = {
      linea: redactada.linea,
      origen: ORIGEN_EDICION,
      senalIds: [fila.id],
      aprobacionId: detalle.aprobacionId ?? null,
      datosPersonalesQuitados: redactada.datosPersonalesQuitados,
      categoriaEspecial: opciones.categoriaEspecial === true,
    };
    const [leccion] = await tx<{ id: string }[]>`
      insert into leccion (tenant_id, puesto_id, titulo, contenido, parametros, estado)
      values (
        ${tenantId}, ${fila.puesto_id}, ${redactada.titulo}, ${json(contenido)}::text::jsonb,
        ${json(redactada.parametros)}::text::jsonb, 'propuesta'
      )
      returning id
    `;
    if (!leccion) throw new Error('La lección no se insertó.');
    await tx`
      insert into leccion_senal (tenant_id, leccion_id, senal_id, senal_creado_en)
      values (${tenantId}, ${leccion.id}, ${fila.id}, ${fila.creado_en}::text::timestamptz)
    `;

    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: fila.puesto_id,
      tareaId: fila.tarea_id,
      accion: ACCIONES_APRENDIZAJE.leccionPropuesta,
      datosReferenciados: [
        { tipo: 'leccion', id: leccion.id },
        { tipo: 'senal', id: fila.id },
        { tipo: 'clase_leccion', id: redactada.parametros.clase },
        { tipo: 'ambito_leccion', id: opciones.ambito ?? 'puesto' },
      ],
      resultado: 'exito',
    });

    return {
      leccionId: leccion.id,
      puestoId: fila.puesto_id,
      ambito: opciones.ambito ?? 'puesto',
      titulo: redactada.titulo,
      linea: redactada.linea,
      nueva: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Versión activa y memoria congelada
// ---------------------------------------------------------------------------

export interface VersionActiva {
  versionPuestoId: string;
  numero: number;
}

/** La versión con la que debe arrancar la tarea siguiente del puesto. */
export async function versionActivaDe(
  tx: postgres.TransactionSql,
  tenantId: string,
  puestoId: string,
): Promise<VersionActiva> {
  const [fila] = await tx<{ id: string; numero: string }[]>`
    select v.id, v.numero from puesto p
    join version_puesto v on v.tenant_id = p.tenant_id and v.id = p.version_activa_id
    where p.tenant_id = ${tenantId} and p.id = ${puestoId}
  `;
  if (!fila) {
    throw new ErrorDeAprendizaje('no_encontrada', `El puesto ${puestoId} no tiene versión activa.`);
  }
  return { versionPuestoId: fila.id, numero: Number(fila.numero) };
}

/** Lee la memoria congelada tolerando las versiones anteriores, que guardan `{}`. */
export function leerMemoriaCongelada(valor: unknown): esquemas.MemoriaCongelada {
  return esquemas.validarCarga(
    esquemas.memoriaCongelada,
    valor ?? {},
    'version_puesto.memoria_congelada',
  );
}

/** Las líneas que el prompt incluye bajo «Lo que ya sabes». */
export function lineasDeMemoria(valor: unknown): string[] {
  return leerMemoriaCongelada(valor).lineas.map((linea) => linea.texto);
}

function leerLeccionesOrigen(valor: unknown): esquemas.LeccionesOrigen {
  return esquemas.validarCarga(
    esquemas.leccionesOrigen,
    valor ?? [],
    'version_puesto.lecciones_origen',
  );
}

// ---------------------------------------------------------------------------
// Promoción
// ---------------------------------------------------------------------------

/** Lo que la puerta del Evaluador recibe para certificar o bloquear. */
export interface VersionCandidata {
  tenantId: string;
  puestoId: string;
  leccionId: string;
  parametros: esquemas.ParametrosLeccion;
  memoria: esquemas.MemoriaCongelada;
  /**
   * Habilidades congeladas que tendría la versión si se certifica, ya con la
   * candidata añadida. Solo se rellena cuando `parametros.clase` es `habilidad`.
   */
  habilidadesCongeladas?: esquemas.HabilidadesCongeladas | undefined;
  /**
   * Nombres de herramienta que el puesto tiene en su lista blanca (todos sus
   * conectores autorizados). La puerta la usa para bloquear una habilidad que
   * nombra una herramienta fuera de esa lista (decisión 4 de la especificación).
   */
  listaBlancaHerramientas?: readonly string[] | undefined;
  /** Ámbito de la promoción. Ausente es `puesto`. */
  ambito?: AmbitoDeLeccion | undefined;
  /** Departamento que recibe la lección. Solo con `ambito: 'departamento'`. */
  departamentoId?: string | undefined;
  /** La lección está marcada como categoría especial. */
  categoriaEspecial?: boolean | undefined;
  /** Clases de dato personal que se quitaron al redactarla, sin valores. */
  datosPersonalesQuitados?: readonly string[] | undefined;
}

export interface CasoDeLaPuerta {
  id: string;
  superado: boolean;
  puntuacion: number;
  diagnostico: string;
}

export interface ResultadoDeLaPuerta {
  certificada: boolean;
  evaluador: string;
  casos: CasoDeLaPuerta[];
}

/**
 * La puerta del Evaluador. Se inyecta para que `learning` no dependa de `evals`: el
 * trabajador la monta con `certificarPromocion` de `@aiw/evals`, y las pruebas pueden
 * montar una que bloquee.
 */
export type PuertaDeEvaluacion = (
  candidata: VersionCandidata,
) => ResultadoDeLaPuerta | Promise<ResultadoDeLaPuerta>;

export interface PeticionDePromocion {
  leccionId: string;
  /** Quién promociona. En v0 siempre una persona: sin ella no hay promoción. */
  personaId: string;
  puerta: PuertaDeEvaluacion;
  motivo?: string | undefined;
}

export interface VersionPromovida {
  puestoId: string;
  versionAnteriorId: string;
  versionPuestoId: string;
  numero: number;
}

export type ResultadoDePromocion =
  | {
      estado: 'promocionada';
      promocionId: string;
      puestoId: string;
      versionAnteriorId: string;
      versionPuestoId: string;
      numero: number;
      resultados: ResultadoDeLaPuerta;
      /**
       * Todas las versiones que dejó la promoción: una para una lección de puesto, una
       * por puesto del departamento para una de departamento. La primera campo a campo
       * (`puestoId`, `versionPuestoId`…) es la del puesto que originó la lección.
       */
      versiones: VersionPromovida[];
    }
  | { estado: 'bloqueada'; puestoId: string; resultados: ResultadoDeLaPuerta };

/**
 * Promociona a mano una lección propuesta: crea la versión inmutable siguiente del
 * puesto con la lección en su memoria congelada y mueve el puntero.
 *
 * La puerta del Evaluador va antes de escribir nada. Si bloquea, no hay versión y
 * queda en el libro `aprendizaje.promocion.bloqueada` con los casos que fallaron:
 * el bloqueo es información de auditoría, no un error que se traga el servidor.
 */
export async function promocionarLeccion(
  cliente: postgres.Sql,
  tenantId: string,
  peticion: PeticionDePromocion,
): Promise<ResultadoDePromocion> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(peticion.leccionId, 'leccionId');
  if (!UUID.test(peticion.personaId)) {
    throw new ErrorDeAprendizaje(
      'sin_persona',
      'Una promoción la hace una persona: indica su identificador.',
    );
  }

  return conTenant(cliente, tenantId, async (tx) => {
    const [persona] = await tx<{ id: string; activa: boolean }[]>`
      select id, activa from persona where tenant_id = ${tenantId} and id = ${peticion.personaId}
    `;
    if (!persona) {
      throw new ErrorDeAprendizaje(
        'sin_persona',
        `La persona ${peticion.personaId} no existe en esta organización.`,
      );
    }

    const [leccion] = await tx<
      {
        id: string;
        puesto_id: string;
        parametros: unknown;
        contenido: {
          senalIds?: string[];
          categoriaEspecial?: boolean;
          datosPersonalesQuitados?: string[];
        };
      }[]
    >`
      select id, puesto_id, parametros, contenido from leccion
      where tenant_id = ${tenantId} and id = ${peticion.leccionId}
    `;
    if (!leccion) {
      throw new ErrorDeAprendizaje('no_encontrada', `No hay lección ${peticion.leccionId}.`);
    }
    const parametros = esquemas.validarCarga(
      esquemas.parametrosLeccion,
      leccion.parametros,
      'leccion.parametros',
    );
    if (parametros.destino === 'departamento') {
      return promocionarParaElDepartamento(tx, tenantId, peticion, persona, leccion, parametros);
    }
    await bloquear(tx, `puesto:${leccion.puesto_id}`);

    const [yaPromocionada] = await tx<{ id: string }[]>`
      select id from promocion where tenant_id = ${tenantId} and leccion_id = ${leccion.id}
    `;
    if (yaPromocionada) {
      throw new ErrorDeAprendizaje(
        'ya_promocionada',
        `La lección ${leccion.id} ya se promocionó (${yaPromocionada.id}). Para recuperarla, vuelve a su versión.`,
      );
    }

    const [activa] = await tx<
      {
        id: string;
        prompt: string;
        politica: unknown;
        habilidades_congeladas: unknown;
        memoria_congelada: unknown;
        lecciones_origen: unknown;
        ultimo: string;
      }[]
    >`
      select v.id, v.prompt, v.politica, v.habilidades_congeladas, v.memoria_congelada,
        v.lecciones_origen,
        (select max(numero) from version_puesto
          where tenant_id = ${tenantId} and puesto_id = p.id) as ultimo
      from puesto p
      join version_puesto v on v.tenant_id = p.tenant_id and v.id = p.version_activa_id
      where p.tenant_id = ${tenantId} and p.id = ${leccion.puesto_id}
    `;
    if (!activa) {
      throw new ErrorDeAprendizaje(
        'no_encontrada',
        `El puesto ${leccion.puesto_id} no tiene versión activa sobre la que promocionar.`,
      );
    }

    // Habilidades en el bucle: una lección de clase `habilidad` no añade una línea
    // de memoria, añade un elemento a `habilidades_congeladas`. El resto del camino
    // —puerta, versión inmutable, puntero, libro— es el mismo para las dos clases
    // (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md, decisión 5).
    const esHabilidad = parametros.clase === 'habilidad';
    const memoriaAnterior = leerMemoriaCongelada(activa.memoria_congelada);
    const memoria: esquemas.MemoriaCongelada = esHabilidad
      ? memoriaAnterior
      : {
          lineas: [
            ...memoriaAnterior.lineas,
            { leccionId: leccion.id, texto: String(parametros.valor) },
          ],
        };

    let habilidadesCandidatas: esquemas.HabilidadesCongeladas | undefined;
    let listaBlancaHerramientas: string[] | undefined;
    if (esHabilidad) {
      const nuevoItem = esquemas.validarCarga(
        esquemas.habilidadCongeladaItem,
        parametros.valor,
        'leccion.parametros.valor',
      );
      const existentes = leerHabilidadesCongeladas(activa.habilidades_congeladas);
      if (existentes.some((habilidad) => habilidad.nombre === nuevoItem.nombre)) {
        throw new ErrorDeAprendizaje(
          'ya_activa',
          `La habilidad «${nuevoItem.nombre}» ya está activa en la versión actual del puesto ${leccion.puesto_id}.`,
        );
      }
      habilidadesCandidatas = [...existentes, nuevoItem];

      const filasListaBlanca = await tx<{ nombre: string }[]>`
        select distinct elem as nombre
        from autorizacion_herramientas ah,
          jsonb_array_elements_text(ah.lista_blanca) as elem
        where ah.tenant_id = ${tenantId} and ah.puesto_id = ${leccion.puesto_id}
      `;
      listaBlancaHerramientas = filasListaBlanca.map((fila) => fila.nombre);
    }

    const resultados = await peticion.puerta({
      tenantId,
      puestoId: leccion.puesto_id,
      leccionId: leccion.id,
      parametros,
      memoria,
      ...(habilidadesCandidatas === undefined
        ? {}
        : { habilidadesCongeladas: habilidadesCandidatas }),
      ...(listaBlancaHerramientas === undefined ? {} : { listaBlancaHerramientas }),
    });

    if (!resultados.certificada) {
      await anotar(tx, tenantId, {
        actorTipo: 'persona',
        actorId: peticion.personaId,
        puestoId: leccion.puesto_id,
        versionPuestoId: activa.id,
        accion: ACCIONES_APRENDIZAJE.promocionBloqueada,
        datosReferenciados: [
          { tipo: 'leccion', id: leccion.id },
          ...resultados.casos
            .filter((caso) => !caso.superado)
            .map((caso) => ({ tipo: 'caso_dorado', id: caso.id })),
        ],
        resultado: 'rechazado',
      });
      return { estado: 'bloqueada', puestoId: leccion.puesto_id, resultados };
    }

    const senalIds = leccion.contenido.senalIds ?? [];
    const leccionesOrigen: esquemas.LeccionesOrigen = [
      ...leerLeccionesOrigen(activa.lecciones_origen),
      { leccionId: leccion.id, senalIds, promocionadaPorPersonaId: peticion.personaId },
    ];
    const numero = Number(activa.ultimo) + 1;
    const habilidadesParaLaVersion =
      habilidadesCandidatas === undefined ? activa.habilidades_congeladas : habilidadesCandidatas;

    const [version] = await tx<{ id: string }[]>`
      insert into version_puesto (
        tenant_id, puesto_id, numero, prompt, politica, habilidades_congeladas,
        memoria_congelada, lecciones_origen, resultados_eval
      ) values (
        ${tenantId}, ${leccion.puesto_id}, ${numero}, ${activa.prompt},
        ${json(activa.politica)}::text::jsonb, ${json(habilidadesParaLaVersion)}::text::jsonb,
        ${json(memoria)}::text::jsonb, ${json(leccionesOrigen)}::text::jsonb,
        ${json(resultados)}::text::jsonb
      )
      returning id
    `;
    if (!version) throw new Error('La versión nueva del puesto no se insertó.');

    let promocion: { id: string } | undefined;
    try {
      [promocion] = await tx<{ id: string }[]>`
        insert into promocion (
          tenant_id, leccion_id, version_puesto_resultante_id, decidida_por_persona_id,
          evidencia, resultados_eval
        ) values (
          ${tenantId}, ${leccion.id}, ${version.id}, ${peticion.personaId},
          ${json({ senalIds, versionAnteriorId: activa.id, motivo: peticion.motivo ?? null, manual: true })}::text::jsonb,
          ${json(resultados)}::text::jsonb
        )
        returning id
      `;
    } catch (error) {
      if (!esViolacionDeUnicidad(error)) throw error;
      throw new ErrorDeAprendizaje(
        'ya_promocionada',
        `La lección ${leccion.id} ya se promocionó. Para recuperarla, vuelve a su versión.`,
      );
    }
    if (!promocion) throw new Error('La promoción no se insertó.');

    await tx`
      update puesto set version_activa_id = ${version.id}, actualizado_en = now()
      where tenant_id = ${tenantId} and id = ${leccion.puesto_id}
    `;

    // La memoria viva es para la búsqueda futura; el prompt se compone con la
    // congelada, que es la que reproduce exactamente lo que vio cada tarea. No
    // aplica a una activación de habilidad: no hay línea de memoria que buscar.
    if (!esHabilidad) {
      const clave = claveDeMemoria(leccion.id);
      await tx`
        insert into memoria (tenant_id, ambito, ambito_id, clave, contenido, metadatos)
        values (
          ${tenantId}, 'puesto', ${leccion.puesto_id}, ${clave}, ${String(parametros.valor)},
          ${json({ leccionId: leccion.id, versionPuestoId: version.id })}::text::jsonb
        )
      `;
    }

    await anotar(tx, tenantId, {
      actorTipo: 'persona',
      actorId: peticion.personaId,
      puestoId: leccion.puesto_id,
      versionPuestoId: version.id,
      accion: ACCIONES_APRENDIZAJE.leccionPromocionada,
      datosReferenciados: [
        { tipo: 'leccion', id: leccion.id },
        { tipo: 'promocion', id: promocion.id },
        { tipo: 'version_puesto', id: version.id },
        { tipo: 'version_puesto_anterior', id: activa.id },
      ],
      resultado: 'exito',
      aprobadaPorPersonaId: peticion.personaId,
      leccionAplicadaId: leccion.id,
    });

    return {
      estado: 'promocionada',
      promocionId: promocion.id,
      puestoId: leccion.puesto_id,
      versionAnteriorId: activa.id,
      versionPuestoId: version.id,
      numero,
      resultados,
      versiones: [
        {
          puestoId: leccion.puesto_id,
          versionAnteriorId: activa.id,
          versionPuestoId: version.id,
          numero,
        },
      ],
    };
  });
}

// ---------------------------------------------------------------------------
// Promoción de una lección de departamento
// ---------------------------------------------------------------------------

/**
 * Quién promociona la memoria de un departamento (decisión 8 de la especificación,
 * Jesús, 2-10-2026): la persona que supervisa el departamento o un administrador de
 * la organización.
 *
 * Hoy no hay roles: toda persona activa es propietaria de su organización, y por tanto
 * administradora, hasta la rebanada «Personas, roles y permisos por equipo» (prevista
 * para el 7-12-2026). Cuando existan, `esAdministrador` pasa a mirar el rol y esta
 * regla se estrecha sin tocar a quien la llama.
 */
export function puedePromocionarDepartamento(
  departamento: { supervisorPersonaId: string | null },
  persona: { id: string; activa: boolean },
): boolean {
  if (!persona.activa) return false;
  const esSupervisor = departamento.supervisorPersonaId === persona.id;
  const esAdministrador = true;
  return esSupervisor || esAdministrador;
}

/** El libro anota la regla aplicada para que una auditoría vea por qué se permitió. */
function motivoDePermiso(
  departamento: { supervisorPersonaId: string | null },
  personaId: string,
): 'supervisor' | 'administrador' {
  return departamento.supervisorPersonaId === personaId ? 'supervisor' : 'administrador';
}

/**
 * Promociona una lección de ámbito departamento: pasa por la misma puerta del
 * Evaluador que la de puesto —una vez por puesto, porque cada uno tendría una memoria
 * candidata distinta— y deja una versión inmutable nueva en cada puesto activo del
 * departamento, más una fila de memoria de ámbito `departamento`. Todo en la misma
 * transacción: o quedan todas las versiones o ninguna.
 *
 * Cada versión se revierte por puesto con `revertirVersion`, sin tocar las demás.
 */
async function promocionarParaElDepartamento(
  tx: postgres.TransactionSql,
  tenantId: string,
  peticion: PeticionDePromocion,
  persona: { id: string; activa: boolean },
  leccion: {
    id: string;
    puesto_id: string;
    contenido: {
      senalIds?: string[];
      categoriaEspecial?: boolean;
      datosPersonalesQuitados?: string[];
    };
  },
  parametros: esquemas.ParametrosLeccion,
): Promise<ResultadoDePromocion> {
  if (parametros.clase !== 'memoria') {
    throw new ErrorDeAprendizaje(
      'no_encontrada',
      'Solo una lección de memoria puede tener ámbito departamento.',
    );
  }
  const [origen] = await tx<{ departamento_id: string; supervisor_persona_id: string | null }[]>`
    select p.departamento_id, d.supervisor_persona_id
    from puesto p
    join departamento d on d.tenant_id = p.tenant_id and d.id = p.departamento_id
    where p.tenant_id = ${tenantId} and p.id = ${leccion.puesto_id}
  `;
  if (!origen) {
    throw new ErrorDeAprendizaje('no_encontrada', `No hay puesto ${leccion.puesto_id}.`);
  }
  const departamento = { supervisorPersonaId: origen.supervisor_persona_id };
  if (!puedePromocionarDepartamento(departamento, persona)) {
    throw new ErrorDeAprendizaje(
      'sin_permiso',
      `La persona ${persona.id} no puede promocionar la memoria del departamento ${origen.departamento_id}.`,
    );
  }

  // Primero el departamento y después los puestos en orden: dos promociones del mismo
  // departamento se serializan en la primera, y ninguna espera a otra con un puesto en
  // la mano. Una promoción o reversión de un solo puesto toma solo su cerrojo.
  await bloquear(tx, `departamento:${origen.departamento_id}`);

  const [yaPromocionada] = await tx<{ id: string }[]>`
    select id from promocion where tenant_id = ${tenantId} and leccion_id = ${leccion.id}
  `;
  if (yaPromocionada) {
    throw new ErrorDeAprendizaje(
      'ya_promocionada',
      `La lección ${leccion.id} ya se promocionó (${yaPromocionada.id}). Para recuperarla, vuelve a la versión anterior de cada puesto.`,
    );
  }

  const puestos = await tx<{ id: string }[]>`
    select id from puesto
    where tenant_id = ${tenantId} and departamento_id = ${origen.departamento_id}
      and (estado = 'activo' or id = ${leccion.puesto_id})
    order by id
  `;
  for (const puesto of puestos) await bloquear(tx, `puesto:${puesto.id}`);

  const activas = await tx<
    {
      puesto_id: string;
      id: string;
      prompt: string;
      politica: unknown;
      habilidades_congeladas: unknown;
      memoria_congelada: unknown;
      lecciones_origen: unknown;
      ultimo: string;
    }[]
  >`
    select p.id as puesto_id, v.id, v.prompt, v.politica, v.habilidades_congeladas,
      v.memoria_congelada, v.lecciones_origen,
      (select max(numero) from version_puesto
        where tenant_id = ${tenantId} and puesto_id = p.id) as ultimo
    from puesto p
    join version_puesto v on v.tenant_id = p.tenant_id and v.id = p.version_activa_id
    where p.tenant_id = ${tenantId} and p.id in ${tx(puestos.map((p) => p.id))}
    order by p.id
  `;
  const sinVersion = puestos.filter((p) => !activas.some((a) => a.puesto_id === p.id));
  if (sinVersion.length > 0) {
    throw new ErrorDeAprendizaje(
      'no_encontrada',
      `El puesto ${sinVersion[0]?.id} no tiene versión activa sobre la que promocionar.`,
    );
  }

  // La puerta, una vez por puesto y sin escribir nada. La primera que bloquea gana.
  const candidatas = [];
  for (const activa of activas) {
    const memoriaAnterior = leerMemoriaCongelada(activa.memoria_congelada);
    const memoria: esquemas.MemoriaCongelada = {
      lineas: [
        ...memoriaAnterior.lineas,
        { leccionId: leccion.id, texto: String(parametros.valor) },
      ],
    };
    const resultados = await peticion.puerta({
      tenantId,
      puestoId: activa.puesto_id,
      leccionId: leccion.id,
      parametros,
      memoria,
      ambito: 'departamento',
      departamentoId: origen.departamento_id,
      categoriaEspecial: leccion.contenido.categoriaEspecial === true,
      datosPersonalesQuitados: leccion.contenido.datosPersonalesQuitados ?? [],
    });
    if (!resultados.certificada) {
      await anotar(tx, tenantId, {
        actorTipo: 'persona',
        actorId: peticion.personaId,
        puestoId: activa.puesto_id,
        versionPuestoId: activa.id,
        accion: ACCIONES_APRENDIZAJE.promocionBloqueada,
        datosReferenciados: [
          { tipo: 'leccion', id: leccion.id },
          { tipo: 'ambito_leccion', id: 'departamento' },
          ...resultados.casos
            .filter((caso) => !caso.superado)
            .map((caso) => ({ tipo: 'caso_dorado', id: caso.id })),
        ],
        resultado: 'rechazado',
      });
      return { estado: 'bloqueada', puestoId: activa.puesto_id, resultados };
    }
    candidatas.push({ activa, memoria, resultados });
  }

  const senalIds = leccion.contenido.senalIds ?? [];
  const versiones: (VersionPromovida & {
    resultados: ResultadoDeLaPuerta;
    versionAnteriorId: string;
  })[] = [];
  for (const { activa, memoria, resultados } of candidatas) {
    const leccionesOrigen: esquemas.LeccionesOrigen = [
      ...leerLeccionesOrigen(activa.lecciones_origen),
      { leccionId: leccion.id, senalIds, promocionadaPorPersonaId: peticion.personaId },
    ];
    const numero = Number(activa.ultimo) + 1;
    const [version] = await tx<{ id: string }[]>`
      insert into version_puesto (
        tenant_id, puesto_id, numero, prompt, politica, habilidades_congeladas,
        memoria_congelada, lecciones_origen, resultados_eval
      ) values (
        ${tenantId}, ${activa.puesto_id}, ${numero}, ${activa.prompt},
        ${json(activa.politica)}::text::jsonb, ${json(activa.habilidades_congeladas)}::text::jsonb,
        ${json(memoria)}::text::jsonb, ${json(leccionesOrigen)}::text::jsonb,
        ${json(resultados)}::text::jsonb
      )
      returning id
    `;
    if (!version) throw new Error('La versión nueva del puesto no se insertó.');
    versiones.push({
      puestoId: activa.puesto_id,
      versionAnteriorId: activa.id,
      versionPuestoId: version.id,
      numero,
      resultados,
    });
  }

  const deOrigen = versiones.find((v) => v.puestoId === leccion.puesto_id);
  if (!deOrigen) throw new Error('El puesto de origen no recibió su versión.');

  let promocion: { id: string } | undefined;
  try {
    [promocion] = await tx<{ id: string }[]>`
      insert into promocion (
        tenant_id, leccion_id, version_puesto_resultante_id, decidida_por_persona_id,
        evidencia, resultados_eval
      ) values (
        ${tenantId}, ${leccion.id}, ${deOrigen.versionPuestoId}, ${peticion.personaId},
        ${json({
          senalIds,
          versionAnteriorId: deOrigen.versionAnteriorId,
          motivo: peticion.motivo ?? null,
          manual: true,
          ambito: 'departamento',
          departamentoId: origen.departamento_id,
          permiso: motivoDePermiso(departamento, peticion.personaId),
        })}::text::jsonb,
        ${json(deOrigen.resultados)}::text::jsonb
      )
      returning id
    `;
  } catch (error) {
    if (!esViolacionDeUnicidad(error)) throw error;
    throw new ErrorDeAprendizaje(
      'ya_promocionada',
      `La lección ${leccion.id} ya se promocionó. Para recuperarla, vuelve a la versión anterior de cada puesto.`,
    );
  }
  if (!promocion) throw new Error('La promoción no se insertó.');

  for (const version of versiones) {
    await tx`
      insert into promocion_version (
        tenant_id, promocion_id, puesto_id, version_puesto_id, version_anterior_id
      ) values (
        ${tenantId}, ${promocion.id}, ${version.puestoId}, ${version.versionPuestoId},
        ${version.versionAnteriorId}
      )
    `;
    await tx`
      update puesto set version_activa_id = ${version.versionPuestoId}, actualizado_en = now()
      where tenant_id = ${tenantId} and id = ${version.puestoId}
    `;
  }

  // Una sola fila viva para todo el departamento. El prompt de cada puesto se compone
  // con su memoria congelada; esta fila sirve a la búsqueda y a la lectura por
  // departamento (`leerMemoriaDeDepartamento`). Una lección de categoría especial no
  // llega aquí: la puerta la bloquea antes, y la columna lo recuerda.
  await tx`
    insert into memoria (
      tenant_id, ambito, ambito_id, clave, contenido, metadatos, categoria_especial
    ) values (
      ${tenantId}, 'departamento', ${origen.departamento_id}, ${claveDeMemoria(leccion.id)},
      ${String(parametros.valor)},
      ${json({ leccionId: leccion.id, promocionId: promocion.id })}::text::jsonb,
      ${leccion.contenido.categoriaEspecial === true}
    )
  `;

  for (const version of versiones) {
    await anotar(tx, tenantId, {
      actorTipo: 'persona',
      actorId: peticion.personaId,
      puestoId: version.puestoId,
      versionPuestoId: version.versionPuestoId,
      accion: ACCIONES_APRENDIZAJE.leccionPromocionada,
      datosReferenciados: [
        { tipo: 'leccion', id: leccion.id },
        { tipo: 'promocion', id: promocion.id },
        { tipo: 'ambito_leccion', id: 'departamento' },
        { tipo: 'version_puesto', id: version.versionPuestoId },
        { tipo: 'version_puesto_anterior', id: version.versionAnteriorId },
      ],
      resultado: 'exito',
      aprobadaPorPersonaId: peticion.personaId,
      leccionAplicadaId: leccion.id,
    });
  }

  return {
    estado: 'promocionada',
    promocionId: promocion.id,
    puestoId: deOrigen.puestoId,
    versionAnteriorId: deOrigen.versionAnteriorId,
    versionPuestoId: deOrigen.versionPuestoId,
    numero: deOrigen.numero,
    resultados: deOrigen.resultados,
    versiones: versiones.map(({ puestoId, versionAnteriorId, versionPuestoId, numero }) => ({
      puestoId,
      versionAnteriorId,
      versionPuestoId,
      numero,
    })),
  };
}

/**
 * La memoria viva de departamento que lee un puesto: las líneas de su departamento
 * que no han caducado ni son de categoría especial. Un puesto de otro departamento, o
 * de otra organización, no ve ninguna: la consulta cruza por el departamento del
 * puesto y la RLS acota el tenant.
 *
 * El prompt no usa esto: se compone con la memoria congelada de la versión, que es la
 * que reproduce lo que vio cada tarea. Esto es para consultas y para comprobar el
 * aislamiento.
 */
export async function leerMemoriaDeDepartamento(
  cliente: postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<string[]> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(puestoId, 'puestoId');
  return conTenant(cliente, tenantId, async (tx) => {
    const filas = await tx<{ contenido: string }[]>`
      select m.contenido
      from puesto p
      join memoria m on m.tenant_id = p.tenant_id and m.ambito = 'departamento'
        and m.ambito_id = p.departamento_id
      where p.tenant_id = ${tenantId} and p.id = ${puestoId}
        and m.caduca_en is null and not m.categoria_especial
      order by m.creado_en, m.id
    `;
    return filas.map((fila) => fila.contenido);
  });
}

// ---------------------------------------------------------------------------
// Reversión
// ---------------------------------------------------------------------------

export interface PeticionDeReversion {
  puestoId: string;
  /** La versión a la que se vuelve. Tiene que ser del mismo puesto. */
  aVersionId: string;
  personaId: string;
  motivo?: string | undefined;
}

export interface ReversionHecha {
  desdeVersionId: string;
  aVersionId: string;
  numero: number;
  /** Lecciones que estaban en la versión de la que se sale y no en la de destino. */
  retiradas: string[];
  /** Lecciones que vuelven, si la versión de destino es posterior. */
  repuestas: string[];
}

/**
 * Vuelve a otra versión del puesto en una operación: mueve el puntero, caduca la
 * memoria viva de las lecciones retiradas y lo anota con la traza de cuáles son.
 *
 * No crea versión: la de destino ya existe, es inmutable y es exactamente la que
 * vio cada tarea que corrió con ella.
 */
export async function revertirVersion(
  cliente: postgres.Sql,
  tenantId: string,
  peticion: PeticionDeReversion,
): Promise<ReversionHecha> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(peticion.puestoId, 'puestoId');
  exigirUuid(peticion.aVersionId, 'aVersionId');
  if (!UUID.test(peticion.personaId)) {
    throw new ErrorDeAprendizaje('sin_persona', 'Una reversión la hace una persona.');
  }

  return conTenant(cliente, tenantId, async (tx) => {
    await bloquear(tx, `puesto:${peticion.puestoId}`);
    const [persona] = await tx<{ id: string }[]>`
      select id from persona where tenant_id = ${tenantId} and id = ${peticion.personaId}
    `;
    if (!persona) {
      throw new ErrorDeAprendizaje('sin_persona', `La persona ${peticion.personaId} no existe.`);
    }

    const versiones = await tx<
      {
        id: string;
        puesto_id: string;
        numero: string;
        lecciones_origen: unknown;
        activa: boolean;
      }[]
    >`
      select v.id, v.puesto_id, v.numero, v.lecciones_origen,
        (v.id = p.version_activa_id) as activa
      from version_puesto v
      join puesto p on p.tenant_id = v.tenant_id and p.id = ${peticion.puestoId}
      where v.tenant_id = ${tenantId} and v.puesto_id = p.id
        and (v.id = ${peticion.aVersionId} or v.id = p.version_activa_id)
    `;
    // Una versión de otro puesto no sale en la consulta: `destino` queda vacío y
    // se rechaza como ajena, sin llegar a mover nada.
    const destino = versiones.find((v) => v.id === peticion.aVersionId);
    const actual = versiones.find((v) => v.activa);
    if (!actual) {
      throw new ErrorDeAprendizaje(
        'no_encontrada',
        `El puesto ${peticion.puestoId} no tiene versión activa.`,
      );
    }
    if (!destino) {
      throw new ErrorDeAprendizaje(
        'version_ajena',
        `La versión ${peticion.aVersionId} no es del puesto ${peticion.puestoId}.`,
      );
    }
    if (destino.id === actual.id) {
      throw new ErrorDeAprendizaje('ya_activa', `La versión ${destino.id} ya es la activa.`);
    }

    const enActual = new Set(leerLeccionesOrigen(actual.lecciones_origen).map((l) => l.leccionId));
    const enDestino = new Set(
      leerLeccionesOrigen(destino.lecciones_origen).map((l) => l.leccionId),
    );
    const retiradas = [...enActual].filter((id) => !enDestino.has(id));
    const repuestas = [...enDestino].filter((id) => !enActual.has(id));

    await tx`
      update puesto set version_activa_id = ${destino.id}, actualizado_en = now()
      where tenant_id = ${tenantId} and id = ${peticion.puestoId}
    `;
    if (retiradas.length > 0) {
      await tx`
        update memoria set caduca_en = now(), actualizado_en = now()
        where tenant_id = ${tenantId} and ambito = 'puesto' and ambito_id = ${peticion.puestoId}
          and clave in ${tx(retiradas.map(claveDeMemoria))} and caduca_en is null
      `;
    }
    if (repuestas.length > 0) {
      await tx`
        update memoria set caduca_en = null, actualizado_en = now()
        where tenant_id = ${tenantId} and ambito = 'puesto' and ambito_id = ${peticion.puestoId}
          and clave in ${tx(repuestas.map(claveDeMemoria))}
      `;
    }

    // La memoria viva de departamento es de todos los puestos: solo caduca cuando
    // ningún puesto la conserva en su versión activa, y vuelve cuando algún puesto la
    // recupera. Revertir un puesto no la quita a los demás.
    for (const [lista, caduca] of [
      [retiradas, true],
      [repuestas, false],
    ] as const) {
      for (const leccionId of lista) {
        const [viva] = await tx<{ n: string }[]>`
          select count(*)::text as n from puesto p
          join version_puesto v on v.tenant_id = p.tenant_id and v.id = p.version_activa_id
          where p.tenant_id = ${tenantId}
            and v.lecciones_origen @> ${json([{ leccionId }])}::text::jsonb
        `;
        const algunaLaTiene = Number(viva?.n ?? 0) > 0;
        if (caduca && algunaLaTiene) continue;
        await tx`
          update memoria set caduca_en = ${caduca ? tx`now()` : null}, actualizado_en = now()
          where tenant_id = ${tenantId} and ambito = 'departamento'
            and clave = ${claveDeMemoria(leccionId)}
        `;
      }
    }

    await anotar(tx, tenantId, {
      actorTipo: 'persona',
      actorId: peticion.personaId,
      puestoId: peticion.puestoId,
      versionPuestoId: destino.id,
      accion: ACCIONES_APRENDIZAJE.versionRevertida,
      datosReferenciados: [
        { tipo: 'version_puesto_anterior', id: actual.id },
        { tipo: 'version_puesto', id: destino.id },
        ...retiradas.map((id) => ({ tipo: 'leccion_retirada', id })),
        ...repuestas.map((id) => ({ tipo: 'leccion_repuesta', id })),
      ],
      resultado: 'exito',
      aprobadaPorPersonaId: peticion.personaId,
    });

    return {
      desdeVersionId: actual.id,
      aVersionId: destino.id,
      numero: Number(destino.numero),
      retiradas,
      repuestas,
    };
  });
}

// ---------------------------------------------------------------------------
// Expediente
// ---------------------------------------------------------------------------

export type EstadoDerivado = 'propuesta' | 'vigente' | 'retirada';

export interface LeccionDelExpediente {
  leccionId: string;
  titulo: string;
  linea: string;
  estado: EstadoDerivado;
  promocionId: string | null;
  versionPuestoId: string | null;
}

export interface Expediente {
  puestoId: string;
  versionActiva: VersionActiva;
  versiones: { versionPuestoId: string; numero: number; lecciones: string[] }[];
  lecciones: LeccionDelExpediente[];
}

/**
 * Lecciones y versiones de un puesto con su estado derivado. Es lo que el panel
 * enseñará como expediente del agente; aquí lo usan la demo y el CLI.
 */
export async function leerExpediente(
  cliente: postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<Expediente> {
  exigirUuid(tenantId, 'tenantId');
  return conTenant(cliente, tenantId, async (tx) => {
    const versionActiva = await versionActivaDe(tx, tenantId, puestoId);
    const versiones = await tx<{ id: string; numero: string; lecciones_origen: unknown }[]>`
      select id, numero, lecciones_origen from version_puesto
      where tenant_id = ${tenantId} and puesto_id = ${puestoId}
      order by numero
    `;
    const lecciones = await tx<
      {
        id: string;
        titulo: string;
        parametros: { valor?: unknown };
        promocion_id: string | null;
        version_id: string | null;
      }[]
    >`
      select l.id, l.titulo, l.parametros, pr.id as promocion_id,
        pr.version_puesto_resultante_id as version_id
      from leccion l
      left join promocion pr on pr.tenant_id = l.tenant_id and pr.leccion_id = l.id
      where l.tenant_id = ${tenantId} and l.puesto_id = ${puestoId}
      order by l.creado_en
    `;
    const activa = versiones.find((v) => v.id === versionActiva.versionPuestoId);
    const vigentes = new Set(leerLeccionesOrigen(activa?.lecciones_origen).map((l) => l.leccionId));
    return {
      puestoId,
      versionActiva,
      versiones: versiones.map((v) => ({
        versionPuestoId: v.id,
        numero: Number(v.numero),
        lecciones: leerLeccionesOrigen(v.lecciones_origen).map((l) => l.leccionId),
      })),
      lecciones: lecciones.map((l) => ({
        leccionId: l.id,
        titulo: l.titulo,
        linea: String(l.parametros.valor ?? ''),
        estado: vigentes.has(l.id) ? 'vigente' : l.promocion_id ? 'retirada' : 'propuesta',
        promocionId: l.promocion_id,
        versionPuestoId: l.version_id,
      })),
    };
  });
}
