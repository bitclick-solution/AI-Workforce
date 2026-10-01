/**
 * Habilidades en el bucle del agente (mecanismo, sin catálogo de contenido).
 *
 * El aprendizaje v0 solo sabía promocionar lecciones de memoria. Esta rebanada
 * añade la clase `habilidad` del ADR-005 al mismo camino: una habilidad se siembra
 * como una lección propuesta de clase `habilidad`, y se activa para un puesto con
 * la misma puerta del Evaluador que ya certifica la memoria
 * (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md, decisión 5).
 *
 * Nada aquí copia texto de ningún repositorio de terceros: esto es mecanismo, no
 * contenido. El catálogo de habilidades de Finanzas para España es una rebanada
 * propia que llena `apps/platform-agents/src/catalogo/habilidades.json`.
 */
import { conTenant } from '@aiw/db';
import { esquemas } from '@aiw/domain';
import { anotar } from '@aiw/ledger';
import type postgres from 'postgres';

import { ACCIONES_APRENDIZAJE, ErrorDeAprendizaje, json } from './comun.js';

/** Lee las habilidades congeladas tolerando las versiones anteriores, que guardan `[]`. */
export function leerHabilidadesCongeladas(valor: unknown): esquemas.HabilidadesCongeladas {
  return esquemas.validarCarga(
    esquemas.habilidadesCongeladas,
    valor ?? [],
    'version_puesto.habilidades_congeladas',
  );
}

/**
 * Las líneas que el prompt incluye bajo «Habilidades que puedes cargar»: nombre y
 * casos que aplican, nunca pasos ni comprobaciones. Esa es la frontera de la
 * decisión 1: el índice entra siempre, el cuerpo solo cuando `cargar_habilidad` lo
 * pide.
 */
export function lineasDeHabilidades(valor: unknown): string[] {
  return leerHabilidadesCongeladas(valor).map((habilidad) => {
    const casos = habilidad.casosQueAplican.join('; ') || 'sin casos declarados';
    return `${habilidad.nombre}: ${casos}`;
  });
}

/** Busca el cuerpo de una habilidad congelada por su nombre exacto. */
export function buscarHabilidadCongelada(
  valor: unknown,
  nombre: string,
): esquemas.HabilidadCongeladaItem | undefined {
  return leerHabilidadesCongeladas(valor).find((habilidad) => habilidad.nombre === nombre);
}

/** Definición de catálogo de una habilidad, tal como la valida su propio esquema Zod. */
export interface DefinicionDeHabilidad {
  nombre: string;
  version: number;
  casosQueAplican: string[];
  pasos: string[];
  comprobaciones: string[];
  herramientas?: string[] | undefined;
}

export interface HabilidadSembrada {
  habilidadId: string;
  /** `false` cuando ya existía una fila con el mismo nombre y versión: no se duplica. */
  nueva: boolean;
}

/**
 * Siembra una habilidad del catálogo en la fila `habilidad`. Idempotente por
 * `(tenant, nombre, version)`, la misma clave que impone la base.
 *
 * No la activa para ningún puesto: eso es `proponerActivacionDeHabilidad` seguido de
 * `promocionarLeccion`. Sembrar y activar son pasos separados porque la misma
 * habilidad puede ofrecerse a varios puestos con su propia puerta cada vez.
 */
export async function sembrarHabilidad(
  cliente: postgres.Sql,
  tenantId: string,
  definicion: DefinicionDeHabilidad,
): Promise<HabilidadSembrada> {
  return conTenant(cliente, tenantId, async (tx) => {
    const [existente] = await tx<{ id: string }[]>`
      select id from habilidad
      where tenant_id = ${tenantId} and nombre = ${definicion.nombre} and version = ${definicion.version}
    `;
    if (existente) return { habilidadId: existente.id, nueva: false };

    const [insertada] = await tx<{ id: string }[]>`
      insert into habilidad (
        tenant_id, nombre, version, pasos, comprobaciones, casos_que_aplican, activa
      ) values (
        ${tenantId}, ${definicion.nombre}, ${definicion.version},
        ${json(definicion.pasos)}::text::jsonb, ${json(definicion.comprobaciones)}::text::jsonb,
        ${json(definicion.casosQueAplican)}::text::jsonb, true
      )
      returning id
    `;
    if (!insertada) throw new Error('La habilidad no se insertó.');

    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      accion: ACCIONES_APRENDIZAJE.habilidadSembrada,
      datosReferenciados: [
        { tipo: 'habilidad', id: insertada.id },
        { tipo: 'habilidad_nombre', id: definicion.nombre },
      ],
      resultado: 'exito',
    });

    return { habilidadId: insertada.id, nueva: true };
  });
}

export interface PeticionDeActivacion {
  puestoId: string;
  habilidadId: string;
}

export interface ActivacionPropuesta {
  leccionId: string;
  /** `false` cuando ya había una lección pendiente para esa habilidad y ese puesto. */
  nueva: boolean;
}

/**
 * Propone la activación de una habilidad para un puesto: una lección de clase
 * `habilidad` en estado `propuesta`, lista para que `promocionarLeccion` la pase
 * por la puerta del Evaluador. No toca `version_puesto`: eso solo lo hace la
 * promoción, y solo si certifica.
 */
export async function proponerActivacionDeHabilidad(
  cliente: postgres.Sql,
  tenantId: string,
  peticion: PeticionDeActivacion,
): Promise<ActivacionPropuesta> {
  return conTenant(cliente, tenantId, async (tx) => {
    const [habilidad] = await tx<
      {
        id: string;
        nombre: string;
        version: string;
        pasos: string[];
        comprobaciones: string[];
        casos_que_aplican: string[];
      }[]
    >`
      select id, nombre, version, pasos, comprobaciones, casos_que_aplican
      from habilidad where tenant_id = ${tenantId} and id = ${peticion.habilidadId}
    `;
    if (!habilidad) {
      throw new ErrorDeAprendizaje(
        'no_encontrada',
        `No hay habilidad ${peticion.habilidadId} en este tenant.`,
      );
    }

    const [puesto] = await tx<{ id: string }[]>`
      select id from puesto where tenant_id = ${tenantId} and id = ${peticion.puestoId}
    `;
    if (!puesto) {
      throw new ErrorDeAprendizaje('no_encontrada', `No hay puesto ${peticion.puestoId}.`);
    }

    const [pendiente] = await tx<{ id: string; promocionada: boolean }[]>`
      select l.id, exists(
        select 1 from promocion pr where pr.tenant_id = ${tenantId} and pr.leccion_id = l.id
      ) as promocionada
      from leccion l
      where l.tenant_id = ${tenantId} and l.puesto_id = ${peticion.puestoId}
        and l.parametros->>'clase' = 'habilidad'
        and l.parametros->>'destino' = ${habilidad.nombre}
        and (l.parametros->'valor'->>'version')::bigint = ${habilidad.version}
      order by l.creado_en desc
      limit 1
    `;
    if (pendiente) {
      if (pendiente.promocionada) {
        throw new ErrorDeAprendizaje(
          'ya_promocionada',
          `La habilidad «${habilidad.nombre}» v${habilidad.version} ya está activa en el puesto ${peticion.puestoId}.`,
        );
      }
      return { leccionId: pendiente.id, nueva: false };
    }

    const item: esquemas.HabilidadCongeladaItem = {
      habilidadId: habilidad.id,
      nombre: habilidad.nombre,
      version: Number(habilidad.version),
      casosQueAplican: habilidad.casos_que_aplican ?? [],
      pasos: habilidad.pasos ?? [],
      comprobaciones: habilidad.comprobaciones ?? [],
      herramientas: [],
    };
    const parametros: esquemas.ParametrosLeccion = {
      clase: 'habilidad',
      destino: habilidad.nombre,
      valor: item,
    };

    const [leccion] = await tx<{ id: string }[]>`
      insert into leccion (tenant_id, puesto_id, titulo, contenido, parametros, estado)
      values (
        ${tenantId}, ${peticion.puestoId}, ${`Activar la habilidad ${habilidad.nombre}`},
        ${json({ habilidadId: habilidad.id, nombre: habilidad.nombre, version: item.version })}::text::jsonb,
        ${json(parametros)}::text::jsonb, 'propuesta'
      )
      returning id
    `;
    if (!leccion) throw new Error('La lección de activación no se insertó.');

    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: peticion.puestoId,
      accion: ACCIONES_APRENDIZAJE.leccionPropuesta,
      datosReferenciados: [
        { tipo: 'leccion', id: leccion.id },
        { tipo: 'habilidad', id: habilidad.id },
        { tipo: 'clase_leccion', id: 'habilidad' },
      ],
      resultado: 'exito',
    });

    return { leccionId: leccion.id, nueva: true };
  });
}
