/**
 * Lo que un puesto tiene permitido: lista blanca y nivel por clase de acción.
 *
 * Sale de `autorizacion_herramientas`, que es la tabla N:M entre puesto y conector.
 * Una autorización con `revocada_en` puesta no cuenta: revocar es escribir una
 * fecha, no borrar la fila, porque la auditoría de dentro de seis años tiene que
 * poder decir que este puesto tuvo este permiso entre estas dos fechas.
 *
 * El nivel efectivo de una clase es el menor entre el que concedió la autorización
 * y el que declara la política de la versión de puesto. Los dos tienen que decir sí:
 * la autorización no puede dar más autonomía de la que la política permite, y la
 * política no puede autorizar un conector que nadie conectó.
 */
import { esquemas, NIVELES, type Nivel } from '@aiw/domain';
import type postgres from 'postgres';
import { z } from 'zod';

const listaBlanca = z.array(z.string().min(1));

export interface AutorizacionDePuesto {
  id: string;
  conectorId: string;
  conectorNombre: string;
  /** Nula cuando el conector no necesita credencial. */
  referenciaSecreto: string | null;
  listaBlanca: readonly string[];
  nivelesPorClase: Readonly<Record<string, Nivel>>;
}

interface FilaAutorizacion {
  id: string;
  conector_id: string;
  conector_nombre: string;
  referencia_secreto: string | null;
  lista_blanca: unknown;
  niveles_por_clase: unknown;
}

/**
 * Lee las autorizaciones vivas de un puesto.
 *
 * Solo conectores en estado `activo` o `configurado`: un conector `pausado` o en
 * `error` no sirve herramientas, y descubrirlo al llamar sería tarde.
 */
export async function leerAutorizaciones(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<AutorizacionDePuesto[]> {
  const filas = await tx<FilaAutorizacion[]>`
    select a.id, a.conector_id, c.nombre as conector_nombre, c.referencia_secreto,
           a.lista_blanca, a.niveles_por_clase
    from autorizacion_herramientas a
    join conector c on c.tenant_id = a.tenant_id and c.id = a.conector_id
    where a.tenant_id = ${tenantId}
      and a.puesto_id = ${puestoId}
      and a.revocada_en is null
      and c.estado in ('activo', 'configurado')
    order by c.nombre asc
  `;

  return filas.map((fila) => ({
    id: fila.id,
    conectorId: fila.conector_id,
    conectorNombre: fila.conector_nombre,
    referenciaSecreto: fila.referencia_secreto,
    listaBlanca: esquemas.validarCarga(
      listaBlanca,
      fila.lista_blanca,
      'autorizacion_herramientas.lista_blanca',
    ),
    nivelesPorClase: esquemas.validarCarga(
      esquemas.nivelesPorClase,
      fila.niveles_por_clase,
      'autorizacion_herramientas.niveles_por_clase',
    ),
  }));
}

export interface ContextoDelPuesto {
  estado: string;
  politica: esquemas.PoliticaPuesto;
}

/** Lee el estado del puesto y la política congelada de la versión con la que corre. */
export async function leerContextoDelPuesto(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  puestoId: string,
  versionPuestoId: string,
): Promise<ContextoDelPuesto> {
  const [fila] = await tx<{ estado: string; politica: unknown }[]>`
    select p.estado, v.politica
    from puesto p
    join version_puesto v
      on v.tenant_id = p.tenant_id and v.id = ${versionPuestoId} and v.puesto_id = p.id
    where p.tenant_id = ${tenantId} and p.id = ${puestoId}
  `;
  if (!fila) {
    throw new Error(
      `No hay puesto ${puestoId} con versión ${versionPuestoId} en este tenant: ` +
        'sin política congelada no se autoriza ninguna herramienta.',
    );
  }
  return {
    estado: fila.estado,
    politica: esquemas.validarCarga(
      esquemas.politicaPuesto,
      fila.politica,
      'version_puesto.politica',
    ),
  };
}

/** El menor de dos niveles. N0 es el más restrictivo y N3 el más autónomo. */
export function menorNivel(a: Nivel, b: Nivel): Nivel {
  return NIVELES.indexOf(a) <= NIVELES.indexOf(b) ? a : b;
}

/**
 * Nivel efectivo por clase: la concesión de la autorización con el techo de la
 * política. Una clase que la autorización no menciona no tiene nivel, y el motor
 * de políticas rechaza lo que no tiene nivel.
 */
export function nivelesEfectivos(
  autorizaciones: readonly AutorizacionDePuesto[],
  politica: esquemas.PoliticaPuesto,
): Record<string, Nivel> {
  const efectivos: Record<string, Nivel> = {};
  for (const autorizacion of autorizaciones) {
    for (const [clase, concedido] of Object.entries(autorizacion.nivelesPorClase)) {
      const techo = politica.niveles[clase];
      const nivel = techo === undefined ? concedido : menorNivel(concedido, techo);
      const previo = efectivos[clase];
      // Dos conectores pueden conceder la misma clase: gana el más restrictivo,
      // porque el nivel es del puesto y no de la conexión.
      efectivos[clase] = previo === undefined ? nivel : menorNivel(previo, nivel);
    }
  }
  return efectivos;
}
