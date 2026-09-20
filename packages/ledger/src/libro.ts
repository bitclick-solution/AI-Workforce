/**
 * Punto único de escritura del libro de auditoría.
 *
 * Nadie inserta en `entrada_auditoria` fuera de este módulo. `anotar` encadena el
 * hash, asigna el número de orden y suma al contador en la misma transacción que el
 * cambio que se audita, así que o quedan las dos cosas o no queda ninguna.
 *
 * La serialización por tenant la da un bloqueo consultivo de transacción: dos
 * escrituras del mismo tenant no pueden calcular el mismo número de orden.
 *
 * Nada llega a una columna `jsonb` sin pasar por el esquema Zod de `@aiw/domain`:
 * lo que se guarda aquí hay que poder leerlo dentro de seis años, y una carga que
 * no valida se rechaza antes de entrar, no al intentar interpretarla.
 */
import { esquemas } from '@aiw/domain';
import type postgres from 'postgres';

import {
  HASH_GENESIS,
  calcularHash,
  normalizarImporte,
  verificarCadena,
  type ContenidoEntrada,
  type DatoReferenciado,
  type EslabonVerificable,
  type ResultadoVerificacion,
} from './hash.js';

/** Cambio de nivel que anota la entrada, validado por el esquema de `@aiw/domain`. */
export type CambioDeNivel = esquemas.CambioDeNivel;

export interface EntradaNueva {
  actorTipo: ContenidoEntrada['actorTipo'];
  actorId?: string | null | undefined;
  puestoId?: string | null | undefined;
  versionPuestoId?: string | null | undefined;
  tareaId?: string | null | undefined;
  pasoId?: string | null | undefined;
  accion: string;
  herramienta?: string | null | undefined;
  datosReferenciados?: readonly DatoReferenciado[] | undefined;
  resultado: ContenidoEntrada['resultado'];
  costeEuros?: number | undefined;
  duracionMs?: number | undefined;
  aprobadaPorPersonaId?: string | null | undefined;
  leccionAplicadaId?: string | null | undefined;
  nivelAplicado?: ContenidoEntrada['nivelAplicado'];
  cambioDeNivel?: CambioDeNivel | null | undefined;
}

/** Lo que suma esta acción al contador, además de la propia acción. */
export interface Incrementos {
  tareas?: number | undefined;
  pasos?: number | undefined;
}

export interface EntradaAnotada {
  id: string;
  numeroOrden: number;
  hash: string;
  hashAnterior: string;
  creadoEn: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirUuid(valor: string, campo: string): string {
  if (!UUID.test(valor)) throw new Error(`${campo} no es un UUID: ${valor}`);
  return valor;
}

/**
 * Anota una acción y suma al contador. Se llama dentro de una transacción con el
 * tenant fijado (`conTenant` de `@aiw/db`); si el tenant de la sesión no
 * coincide con el que se pasa, la política de RLS rechaza la inserción.
 */
export async function anotar(
  tx: postgres.TransactionSql,
  tenantId: string,
  entrada: EntradaNueva,
  incrementos: Incrementos = {},
): Promise<EntradaAnotada> {
  exigirUuid(tenantId, 'tenantId');
  if (entrada.accion.trim().length === 0) {
    throw new Error('Una entrada de auditoría sin acción no dice nada: indica la acción.');
  }

  // Las dos columnas `jsonb` de la entrada pasan por su esquema Zod de `@aiw/domain`
  // antes de tocar la base: una carga que no valida no llega a pedir el bloqueo ni a
  // gastar un número de orden. Se usa el valor validado para el hash y para el
  // `insert`, no el de entrada, así que lo que se firma es exactamente lo que se
  // guarda y con la misma forma.
  const datosReferenciados = esquemas.validarCarga(
    esquemas.datosReferenciados,
    entrada.datosReferenciados ?? [],
    'entrada_auditoria.datos_referenciados',
  );
  // Lo normal es que una acción no cambie ningún nivel: entonces la columna es nula
  // y no hay carga que validar.
  const cambioDeNivel: CambioDeNivel | null =
    entrada.cambioDeNivel === undefined || entrada.cambioDeNivel === null
      ? null
      : esquemas.validarCarga(
          esquemas.cambioDeNivel,
          entrada.cambioDeNivel,
          'entrada_auditoria.cambio_de_nivel',
        );

  // Serializa las escrituras de este tenant durante la transacción y toma la hora
  // del reloj de la base en la misma ida y vuelta. `clock_timestamp()` avanza dentro
  // de la transacción, al contrario que `now()`: dos entradas seguidas no comparten
  // marca. La hora sale de la base y no del proceso porque el panel ordena por
  // `creado_en` y la cadena por `numero_orden`: con relojes distintos en cada
  // instancia de la aplicación, los dos órdenes podrían no coincidir.
  const [reloj] = await tx<{ ahora: Date }[]>`
    select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0)), clock_timestamp() as ahora
  `;
  if (!reloj) throw new Error('La base no devolvió la hora de la entrada.');

  const [ultima] = await tx<{ numero_orden: string; hash: string }[]>`
    select numero_orden, hash
    from entrada_auditoria
    where tenant_id = ${tenantId}
    order by numero_orden desc
    limit 1
  `;

  const numeroOrden = ultima ? Number(ultima.numero_orden) + 1 : 1;
  const hashAnterior = ultima ? ultima.hash : HASH_GENESIS;
  const creadoEn = reloj.ahora;
  const costeEuros = entrada.costeEuros ?? 0;
  const duracionMs = entrada.duracionMs ?? 0;

  const actorId: string | null = entrada.actorId ?? null;
  const puestoId: string | null = entrada.puestoId ?? null;
  const versionPuestoId: string | null = entrada.versionPuestoId ?? null;
  const tareaId: string | null = entrada.tareaId ?? null;
  const pasoId: string | null = entrada.pasoId ?? null;
  const herramienta: string | null = entrada.herramienta ?? null;
  const aprobadaPorPersonaId: string | null = entrada.aprobadaPorPersonaId ?? null;
  const leccionAplicadaId: string | null = entrada.leccionAplicadaId ?? null;
  const nivelAplicado: ContenidoEntrada['nivelAplicado'] = entrada.nivelAplicado ?? null;

  const contenido: ContenidoEntrada = {
    tenantId,
    numeroOrden,
    creadoEn,
    actorTipo: entrada.actorTipo,
    actorId,
    puestoId,
    versionPuestoId,
    tareaId,
    pasoId,
    accion: entrada.accion,
    herramienta,
    datosReferenciados,
    resultado: entrada.resultado,
    costeEuros,
    duracionMs,
    aprobadaPorPersonaId,
    leccionAplicadaId,
    nivelAplicado,
    cambioDeNivel,
  };
  const hash = calcularHash(contenido, hashAnterior);

  const filas = await tx<{ id: string; creado_en: Date }[]>`
    insert into entrada_auditoria (
      tenant_id, numero_orden, actor_tipo, actor_id, puesto_id, version_puesto_id,
      tarea_id, paso_id, accion, herramienta, datos_referenciados, resultado,
      coste_euros, duracion_ms, aprobada_por_persona_id, leccion_aplicada_id,
      nivel_aplicado, cambio_de_nivel, hash_anterior, hash, creado_en
    ) values (
      ${tenantId}, ${numeroOrden}, ${entrada.actorTipo}, ${actorId},
      ${puestoId}, ${versionPuestoId}, ${tareaId},
      ${pasoId}, ${entrada.accion}, ${herramienta},
      ${JSON.stringify(datosReferenciados)}::text::jsonb, ${entrada.resultado},
      ${normalizarImporte(costeEuros)}, ${duracionMs}, ${aprobadaPorPersonaId},
      ${leccionAplicadaId}, ${nivelAplicado},
      ${JSON.stringify(cambioDeNivel)}::text::jsonb,
      ${hashAnterior}, ${hash}, ${creadoEn}
    )
    returning id, creado_en
  `;
  const fila = filas[0];
  if (!fila) throw new Error('La entrada de auditoría no se insertó.');

  await sumarAlContador(tx, tenantId, fila.creado_en, costeEuros, incrementos);

  return { id: fila.id, numeroOrden, hash, hashAnterior, creadoEn: fila.creado_en };
}

/** El contador es una proyección por periodo: toda acción suma una unidad. */
export async function sumarAlContador(
  tx: postgres.TransactionSql,
  tenantId: string,
  momento: Date,
  costeEuros: number,
  incrementos: Incrementos = {},
): Promise<void> {
  const tareas = incrementos.tareas ?? 0;
  const pasos = incrementos.pasos ?? 0;
  await tx`
    insert into contador_consumo (tenant_id, periodo, tareas, pasos, acciones, coste_euros)
    values (
      ${tenantId},
      date_trunc('month', ${momento}::timestamptz)::date,
      ${tareas}, ${pasos}, 1, ${normalizarImporte(costeEuros)}
    )
    on conflict (tenant_id, periodo) do update set
      tareas = contador_consumo.tareas + excluded.tareas,
      pasos = contador_consumo.pasos + excluded.pasos,
      acciones = contador_consumo.acciones + excluded.acciones,
      coste_euros = contador_consumo.coste_euros + excluded.coste_euros,
      actualizado_en = now()
  `;
}

interface FilaEntrada {
  tenant_id: string;
  numero_orden: string;
  creado_en: Date;
  actor_tipo: ContenidoEntrada['actorTipo'];
  actor_id: string | null;
  puesto_id: string | null;
  version_puesto_id: string | null;
  tarea_id: string | null;
  paso_id: string | null;
  accion: string;
  herramienta: string | null;
  datos_referenciados: DatoReferenciado[];
  resultado: ContenidoEntrada['resultado'];
  coste_euros: string;
  duracion_ms: number;
  aprobada_por_persona_id: string | null;
  leccion_aplicada_id: string | null;
  nivel_aplicado: ContenidoEntrada['nivelAplicado'];
  cambio_de_nivel: unknown;
  hash_anterior: string | null;
  hash: string;
}

function aEslabon(fila: FilaEntrada): EslabonVerificable {
  return {
    tenantId: fila.tenant_id,
    numeroOrden: Number(fila.numero_orden),
    creadoEn: fila.creado_en,
    actorTipo: fila.actor_tipo,
    actorId: fila.actor_id,
    puestoId: fila.puesto_id,
    versionPuestoId: fila.version_puesto_id,
    tareaId: fila.tarea_id,
    pasoId: fila.paso_id,
    accion: fila.accion,
    herramienta: fila.herramienta,
    datosReferenciados: fila.datos_referenciados,
    resultado: fila.resultado,
    costeEuros: Number(fila.coste_euros),
    duracionMs: fila.duracion_ms,
    aprobadaPorPersonaId: fila.aprobada_por_persona_id,
    leccionAplicadaId: fila.leccion_aplicada_id,
    nivelAplicado: fila.nivel_aplicado,
    cambioDeNivel: fila.cambio_de_nivel,
    hash: fila.hash,
    hashAnterior: fila.hash_anterior,
  };
}

/** Lee la cadena completa de un tenant en orden. Para auditorías y exportación. */
export async function leerCadena(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
): Promise<EslabonVerificable[]> {
  const filas = await tx<FilaEntrada[]>`
    select * from entrada_auditoria
    where tenant_id = ${tenantId}
    order by numero_orden asc
  `;
  return filas.map(aEslabon);
}

/** Verifica en la base la cadena de un tenant: sin huecos, encadenada y sin alterar. */
export async function verificarCadenaEnBase(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
): Promise<ResultadoVerificacion> {
  return verificarCadena(await leerCadena(tx, tenantId));
}
