/**
 * Puntos de escritura del contador de tareas v0.
 *
 * Se construye sobre `anotar`, no a su lado: aquí no hay ningún `insert` en
 * `contador_consumo` ni en `entrada_auditoria`. Cada función escribe su dato y
 * llama al punto único de escritura del libro, que encadena el hash y suma al
 * contador en la misma transacción. O quedan las tres cosas —dato, entrada y
 * contador— o no queda ninguna.
 *
 * Qué cuenta (ADR-003): la unidad de consumo es la tarea raíz. Las delegaciones y
 * las intervenciones en sala cuentan **dentro** de su tarea raíz, así que suman su
 * consumo —pasos, acciones y coste— pero no una unidad de tarea nueva.
 *
 * El «en tiempo real» del panel sale de `evento_salida`, la salida transaccional
 * del modelo: el publicador hacia Centrifugo es otra rebanada, y este código no
 * habla con Centrifugo ni con nadie de fuera.
 */
import type postgres from 'postgres';

import { normalizarImporte } from './hash.js';
import { anotar, type EntradaAnotada } from './libro.js';

/** Acción del libro con la que se cuenta una tarea raíz. Es su prueba de conteo. */
export const ACCION_TAREA_CONTADA = 'tarea.contada';

/** Acción del libro de un uso de modelo. Lleva el coste, que es lo que suma. */
export const ACCION_USO_MODELO = 'modelo.uso';

/** Acción del libro del alta de una tarifa. */
export const ACCION_TARIFA_REGISTRADA = 'tarifa.registrada';

/** Tipo y destino del evento de salida que refresca el panel. */
export const TIPO_EVENTO_CONTADOR = 'contador.actualizado';
export const DESTINO_EVENTO_CONTADOR = 'panel';

/** Las tarifas se expresan por millón de tokens, que es como las publican. */
export const TOKENS_POR_MILLON = 1_000_000;

/** Decimales de la columna `coste_euros`: el cálculo redondea a esta escala. */
export const DECIMALES_IMPORTE = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exigirUuid(valor: string, campo: string): string {
  if (!UUID.test(valor)) throw new Error(`${campo} no es un UUID: ${valor}`);
  return valor;
}

function exigirTexto(valor: string, campo: string): string {
  const limpio = valor.trim();
  if (limpio.length === 0) throw new Error(`${campo} no puede estar vacío.`);
  return limpio;
}

function exigirEnteroNoNegativo(valor: number, campo: string): number {
  if (!Number.isInteger(valor) || valor < 0) {
    throw new Error(`${campo} tiene que ser un entero no negativo: ${valor}`);
  }
  return valor;
}

function exigirPrecio(valor: number, campo: string): number {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error(`${campo} tiene que ser un importe no negativo: ${valor}`);
  }
  return valor;
}

/**
 * Las fechas viajan a la base como texto ISO 8601 y se convierten en SQL, nunca
 * como `Date`.
 *
 * No es manía: el driver de Drizzle sustituye los serializadores de fecha del
 * cliente de `postgres` que comparte (`drizzle-orm/postgres-js` pone uno
 * transparente para los tipos 1082, 1083, 1114 y 1184), así que un `Date` pasado
 * como parámetro llega al socket sin convertir y `postgres` lo rechaza con
 * `ERR_INVALID_ARG_TYPE`. Con el cliente crudo de las pruebas funcionaría, y el
 * fallo aparecería solo en la aplicación, que es el peor sitio para descubrirlo.
 */
function comoIso(valor: Date, campo: string): string {
  if (Number.isNaN(valor.getTime())) throw new Error(`${campo} no es una fecha válida.`);
  return valor.toISOString();
}

/** Plataforma por defecto cuando no se especifica ninguna (ADR-017): compatibilidad con datos previos a esta rebanada. */
export const PLATAFORMA_POR_DEFECTO = 'primera-parte';

/**
 * Tarifa aplicable a un uso, tal como sale de `tarifa_modelo`.
 *
 * `plataforma` y `multiplicadorListaOficial` son opcionales aquí porque
 * `calcularCosteEuros` nunca los lee: cobra con los `eurosPorMillon*`, que son el
 * precio real ya contratado. Se admiten como datos opcionales para que una tarifa
 * construida a mano en una prueba, sin plataforma, siga siendo una `Tarifa` válida.
 */
export interface Tarifa {
  id: string;
  proveedor: string;
  modelo: string;
  eurosPorMillonEntrada: number;
  eurosPorMillonSalida: number;
  eurosPorMillonEntradaCache: number;
  vigenteDesde: Date;
  plataforma?: string | undefined;
  multiplicadorListaOficial?: number | undefined;
}

/** Tokens de una llamada al modelo, tal como los devuelve el proveedor. */
export interface TokensUsados {
  entrada: number;
  salida: number;
  /** Tokens de entrada servidos de caché, que se tarifan aparte y más baratos. */
  entradaCache?: number | undefined;
}

/**
 * Coste en euros de unos tokens con una tarifa. Función pura y sin ningún precio
 * escrito dentro: el precio siempre llega como dato.
 *
 * Redondea a la escala de la columna. Un uso pequeño puede costar menos que la
 * última cifra y quedarse en cero: eso es lo correcto, porque el coste que se
 * factura es el que la base puede guardar, no uno que no cabe.
 */
export function calcularCosteEuros(tarifa: Tarifa, tokens: TokensUsados): number {
  const entrada = exigirEnteroNoNegativo(tokens.entrada, 'tokens.entrada');
  const salida = exigirEnteroNoNegativo(tokens.salida, 'tokens.salida');
  const cache = exigirEnteroNoNegativo(tokens.entradaCache ?? 0, 'tokens.entradaCache');

  const bruto =
    (entrada * exigirPrecio(tarifa.eurosPorMillonEntrada, 'eurosPorMillonEntrada')) /
      TOKENS_POR_MILLON +
    (salida * exigirPrecio(tarifa.eurosPorMillonSalida, 'eurosPorMillonSalida')) /
      TOKENS_POR_MILLON +
    (cache * exigirPrecio(tarifa.eurosPorMillonEntradaCache, 'eurosPorMillonEntradaCache')) /
      TOKENS_POR_MILLON;

  const factor = 10 ** DECIMALES_IMPORTE;
  return Math.round(bruto * factor) / factor;
}

interface FilaTarifa {
  id: string;
  proveedor: string;
  modelo: string;
  euros_por_millon_entrada: string;
  euros_por_millon_salida: string;
  euros_por_millon_entrada_cache: string;
  plataforma: string;
  multiplicador_lista_oficial: string;
  vigente_desde: Date;
}

function aTarifa(fila: FilaTarifa): Tarifa {
  return {
    id: fila.id,
    proveedor: fila.proveedor,
    modelo: fila.modelo,
    eurosPorMillonEntrada: Number(fila.euros_por_millon_entrada),
    eurosPorMillonSalida: Number(fila.euros_por_millon_salida),
    eurosPorMillonEntradaCache: Number(fila.euros_por_millon_entrada_cache),
    plataforma: fila.plataforma,
    multiplicadorListaOficial: Number(fila.multiplicador_lista_oficial),
    vigenteDesde: fila.vigente_desde,
  };
}

/**
 * Serializa las escrituras de este tenant durante la transacción con el mismo
 * cerrojo consultivo que usa `anotar`. Los cerrojos consultivos de transacción son
 * reentrantes, así que pedirlo aquí y otra vez dentro de `anotar` no bloquea; lo
 * que consigue es que «mira si ya está contado y, si no, cuéntalo» sea atómico
 * frente a otro trabajador del mismo tenant.
 */
async function serializarTenant(tx: postgres.TransactionSql, tenantId: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
}

/** Carga del evento de salida que refresca el panel. Sin datos personales. */
export interface CargaEventoContador {
  version: 1;
  motivo: 'tarea' | 'uso' | 'tarifa';
  tareaRaizId?: string | null | undefined;
  costeEuros: number;
  numeroOrden: number;
}

/**
 * Deja el evento en la salida transaccional, en la misma transacción que el dato.
 *
 * `CLAUDE.md` es explícito: Centrifugo solo hace fan-out y el evento sale de la
 * salida transaccional, nunca del código de negocio. Si la transacción se deshace,
 * el evento se va con ella y el panel no anuncia un consumo que no ocurrió.
 */
export async function emitirEventoDeContador(
  tx: postgres.TransactionSql,
  tenantId: string,
  carga: CargaEventoContador,
): Promise<void> {
  await tx`
    insert into evento_salida (tenant_id, tipo, destino, carga)
    values (
      ${tenantId}, ${TIPO_EVENTO_CONTADOR}, ${DESTINO_EVENTO_CONTADOR},
      ${JSON.stringify(carga)}::text::jsonb
    )
  `;
}

export interface TareaRaizNueva {
  tareaId: string;
  puestoId: string;
  versionPuestoId?: string | null | undefined;
  /** Quién abre la tarea. Por defecto, la plataforma: la abre el disparador o la sala. */
  actorTipo?: 'persona' | 'agente' | 'plataforma' | 'sistema' | undefined;
  actorId?: string | null | undefined;
}

export interface TareaContada {
  /** `false` cuando ya estaba contada: el reintento no vuelve a sumar. */
  conto: boolean;
  entrada?: EntradaAnotada | undefined;
}

/**
 * Cuenta una tarea raíz: suma una unidad al contador del tenant, una sola vez.
 *
 * La prueba de que se contó es una entrada del libro (`tarea.contada` con el
 * `tarea_id`), no un número que haya que creerse: la idempotencia se comprueba
 * contra el propio libro, que es append-only, y no contra una tabla de marcas que
 * alguien pudiera editar. Reintentar la actividad de Temporal, o ejecutarla en dos
 * trabajadores a la vez, deja una unidad.
 *
 * Una delegación no es una tarea raíz y se rechaza aquí, no en un comentario: su
 * consumo ya cuenta dentro de la raíz (ADR-003).
 */
export async function registrarTareaRaiz(
  tx: postgres.TransactionSql,
  tenantId: string,
  tarea: TareaRaizNueva,
): Promise<TareaContada> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(tarea.tareaId, 'tareaId');
  exigirUuid(tarea.puestoId, 'puestoId');

  const [fila] = await tx<
    { id: string; tarea_raiz_id: string | null; tarea_padre_id: string | null }[]
  >`
    select id, tarea_raiz_id, tarea_padre_id
    from tarea
    where tenant_id = ${tenantId} and id = ${tarea.tareaId}
  `;
  if (!fila) {
    throw new Error(
      `La tarea ${tarea.tareaId} no existe en este tenant: no se cuenta lo que no está.`,
    );
  }
  if (
    fila.tarea_padre_id !== null ||
    (fila.tarea_raiz_id !== null && fila.tarea_raiz_id !== fila.id)
  ) {
    throw new Error(
      `La tarea ${tarea.tareaId} no es raíz: cuelga de otra. Las delegaciones y las ` +
        'intervenciones cuentan dentro de su tarea raíz (ADR-003), no como unidad aparte.',
    );
  }

  await serializarTenant(tx, tenantId);

  const [yaContada] = await tx<{ uno: number }[]>`
    select 1 as uno
    from entrada_auditoria
    where tenant_id = ${tenantId}
      and tarea_id = ${tarea.tareaId}
      and accion = ${ACCION_TAREA_CONTADA}
    limit 1
  `;
  if (yaContada) return { conto: false };

  const entrada = await anotar(
    tx,
    tenantId,
    {
      actorTipo: tarea.actorTipo ?? 'plataforma',
      actorId: tarea.actorId ?? null,
      puestoId: tarea.puestoId,
      versionPuestoId: tarea.versionPuestoId ?? null,
      tareaId: tarea.tareaId,
      accion: ACCION_TAREA_CONTADA,
      datosReferenciados: [{ tipo: 'tarea', id: tarea.tareaId }],
      resultado: 'exito',
    },
    { tareas: 1 },
  );

  await emitirEventoDeContador(tx, tenantId, {
    version: 1,
    motivo: 'tarea',
    tareaRaizId: tarea.tareaId,
    costeEuros: 0,
    numeroOrden: entrada.numeroOrden,
  });

  return { conto: true, entrada };
}

export interface UsoDeModeloNuevo {
  tareaId: string;
  pasoId?: string | null | undefined;
  puestoId: string;
  versionPuestoId: string;
  proveedor: string;
  modelo: string;
  /** Plataforma real que sirvió la llamada (ADR-017). Por defecto, `primera-parte`. */
  plataforma?: string | undefined;
  tokens: TokensUsados;
  llamadas?: number | undefined;
  /**
   * Clave que hace idempotente el registro. Lo natural es el identificador de la
   * petición del proveedor; mientras no exista, una clave determinista del paso.
   */
  claveIdempotencia: string;
  /** Momento del uso. Decide qué tarifa se le aplica. Por defecto, el reloj de la base. */
  momento?: Date | undefined;
}

export interface UsoRegistrado {
  id: string;
  tarifaId: string;
  costeEuros: number;
  tareaRaizId: string;
  /** `true` cuando la clave ya estaba registrada: el reintento no vuelve a cobrar. */
  yaEstaba: boolean;
  entrada?: EntradaAnotada | undefined;
}

/**
 * Registra un uso real de modelo, le pone precio con la tarifa vigente y lo suma.
 *
 * El coste se calcula aquí y se congela en la fila: la factura de este mes no
 * cambia porque el proveedor suba el precio el que viene. Sin tarifa vigente, falla
 * y no deja rastro: preferimos parar a inventar un precio, porque un coste inventado
 * es peor que un coste que falta.
 */
export async function registrarUsoDeModelo(
  tx: postgres.TransactionSql,
  tenantId: string,
  uso: UsoDeModeloNuevo,
): Promise<UsoRegistrado> {
  exigirUuid(tenantId, 'tenantId');
  exigirUuid(uso.tareaId, 'tareaId');
  exigirUuid(uso.puestoId, 'puestoId');
  exigirUuid(uso.versionPuestoId, 'versionPuestoId');
  if (uso.pasoId !== undefined && uso.pasoId !== null) exigirUuid(uso.pasoId, 'pasoId');
  const proveedor = exigirTexto(uso.proveedor, 'proveedor');
  const modelo = exigirTexto(uso.modelo, 'modelo');
  const plataforma = exigirTexto(uso.plataforma ?? PLATAFORMA_POR_DEFECTO, 'plataforma');
  const clave = exigirTexto(uso.claveIdempotencia, 'claveIdempotencia');
  const llamadas = uso.llamadas ?? 1;
  if (!Number.isInteger(llamadas) || llamadas < 1) {
    throw new Error(`llamadas tiene que ser un entero positivo: ${llamadas}`);
  }
  const tokens: TokensUsados = {
    entrada: exigirEnteroNoNegativo(uso.tokens.entrada, 'tokens.entrada'),
    salida: exigirEnteroNoNegativo(uso.tokens.salida, 'tokens.salida'),
    entradaCache: exigirEnteroNoNegativo(uso.tokens.entradaCache ?? 0, 'tokens.entradaCache'),
  };

  const [tareaFila] = await tx<{ id: string; raiz: string }[]>`
    select id, coalesce(tarea_raiz_id, id) as raiz
    from tarea
    where tenant_id = ${tenantId} and id = ${uso.tareaId}
  `;
  if (!tareaFila) {
    throw new Error(
      `La tarea ${uso.tareaId} no existe en este tenant: el uso no tiene dónde sumar.`,
    );
  }
  const tareaRaizId = tareaFila.raiz;

  await serializarTenant(tx, tenantId);

  const [repetido] = await tx<
    { id: string; tarifa_modelo_id: string; coste_euros: string; tarea_raiz_id: string }[]
  >`
    select id, tarifa_modelo_id, coste_euros, tarea_raiz_id
    from uso_modelo
    where tenant_id = ${tenantId} and clave_idempotencia = ${clave}
  `;
  if (repetido) {
    return {
      id: repetido.id,
      tarifaId: repetido.tarifa_modelo_id,
      costeEuros: Number(repetido.coste_euros),
      tareaRaizId: repetido.tarea_raiz_id,
      yaEstaba: true,
    };
  }

  // La hora la pone la base, y la pide en ISO 8601 y no como marca de tiempo: el
  // driver de Drizzle sustituye los intérpretes de fecha del cliente que comparte,
  // así que el mismo `select` devuelve `Date` o cadena según por dónde llegó la
  // conexión. Con texto y `new Date()`, aquí siempre hay una fecha de verdad.
  const [reloj] = await tx<{ ahora: string }[]>`
    select to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ahora
  `;
  if (!reloj) throw new Error('La base no devolvió la hora del uso.');
  const momento = uso.momento ?? new Date(reloj.ahora);

  const tarifa = await tarifaVigente(tx, tenantId, proveedor, modelo, momento, plataforma);
  if (!tarifa) {
    throw new Error(
      `Sin tarifa vigente para ${proveedor}/${modelo} en ${plataforma} en ${momento.toISOString()}: ` +
        'regístrala con registrarTarifa antes de cobrar el uso.',
    );
  }

  const costeEuros = calcularCosteEuros(tarifa, tokens);

  const [insertado] = await tx<{ id: string }[]>`
    insert into uso_modelo (
      tenant_id, tarea_id, tarea_raiz_id, paso_id, puesto_id, version_puesto_id,
      proveedor, modelo, plataforma, tokens_entrada, tokens_salida, tokens_entrada_cache,
      llamadas, tarifa_modelo_id, coste_euros, clave_idempotencia, creado_en
    ) values (
      ${tenantId}, ${uso.tareaId}, ${tareaRaizId}, ${uso.pasoId ?? null},
      ${uso.puestoId}, ${uso.versionPuestoId}, ${proveedor}, ${modelo}, ${plataforma},
      ${tokens.entrada}, ${tokens.salida}, ${tokens.entradaCache ?? 0},
      ${llamadas}, ${tarifa.id}, ${normalizarImporte(costeEuros)}, ${clave}, ${comoIso(momento, 'momento')}::timestamptz
    )
    returning id
  `;
  if (!insertado) throw new Error('El uso de modelo no se insertó.');

  const entrada = await anotar(tx, tenantId, {
    actorTipo: 'agente',
    puestoId: uso.puestoId,
    versionPuestoId: uso.versionPuestoId,
    tareaId: uso.tareaId,
    pasoId: uso.pasoId ?? null,
    accion: ACCION_USO_MODELO,
    herramienta: proveedor,
    datosReferenciados: [
      { tipo: 'modelo', id: modelo, sistema: proveedor },
      { tipo: 'uso_modelo', id: insertado.id },
    ],
    resultado: 'exito',
    costeEuros,
  });

  await emitirEventoDeContador(tx, tenantId, {
    version: 1,
    motivo: 'uso',
    tareaRaizId,
    costeEuros,
    numeroOrden: entrada.numeroOrden,
  });

  return {
    id: insertado.id,
    tarifaId: tarifa.id,
    costeEuros,
    tareaRaizId,
    yaEstaba: false,
    entrada,
  };
}

/**
 * Tarifa que se aplica a un uso: la de mayor `vigente_desde` que no sea posterior
 * al momento del uso. Sin columna de cierre de vigencia, la última gana.
 *
 * `plataforma` es opcional: sin ella, se ignora en el filtro y gana la de mayor
 * `vigente_desde` entre todas las plataformas de ese proveedor y modelo, que es el
 * comportamiento de antes de esta rebanada, cuando no existía la columna.
 */
export async function tarifaVigente(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  proveedor: string,
  modelo: string,
  momento: Date,
  plataforma?: string,
): Promise<Tarifa | undefined> {
  const [fila] = await tx<FilaTarifa[]>`
    select id, proveedor, modelo, euros_por_millon_entrada, euros_por_millon_salida,
           euros_por_millon_entrada_cache, plataforma, multiplicador_lista_oficial, vigente_desde
    from tarifa_modelo
    where tenant_id = ${tenantId}
      and proveedor = ${proveedor}
      and modelo = ${modelo}
      and vigente_desde <= ${comoIso(momento, 'momento')}::timestamptz
      and (${plataforma ?? null}::text is null or plataforma = ${plataforma ?? null})
    order by vigente_desde desc
    limit 1
  `;
  return fila ? aTarifa(fila) : undefined;
}

export interface TarifaNueva {
  proveedor: string;
  modelo: string;
  eurosPorMillonEntrada: number;
  eurosPorMillonSalida: number;
  eurosPorMillonEntradaCache?: number | undefined;
  /** Plataforma real que sirve el modelo (ADR-017). Por defecto, `primera-parte`. */
  plataforma?: string | undefined;
  /** Documental: multiplicador frente a la lista oficial de Anthropic. Por defecto, 1. */
  multiplicadorListaOficial?: number | undefined;
  vigenteDesde: Date;
  /** De dónde sale el precio: lista pública, contrato o acuerdo con el partner. */
  fuente: string;
}

export interface TarifaRegistrada {
  id: string;
  entrada: EntradaAnotada;
}

/**
 * Da de alta una tarifa. Es una operación de plataforma —la ejecuta Operación al
 * cargar el catálogo o al negociar un precio— y queda en el libro como cualquier
 * otra acción: cambiar lo que cuesta un modelo es una decisión auditable.
 */
export async function registrarTarifa(
  tx: postgres.TransactionSql,
  tenantId: string,
  tarifa: TarifaNueva,
): Promise<TarifaRegistrada> {
  exigirUuid(tenantId, 'tenantId');
  const proveedor = exigirTexto(tarifa.proveedor, 'proveedor');
  const modelo = exigirTexto(tarifa.modelo, 'modelo');
  const fuente = exigirTexto(tarifa.fuente, 'fuente');
  const entradaPrecio = exigirPrecio(tarifa.eurosPorMillonEntrada, 'eurosPorMillonEntrada');
  const salidaPrecio = exigirPrecio(tarifa.eurosPorMillonSalida, 'eurosPorMillonSalida');
  const cachePrecio = exigirPrecio(
    tarifa.eurosPorMillonEntradaCache ?? 0,
    'eurosPorMillonEntradaCache',
  );
  const plataforma = exigirTexto(tarifa.plataforma ?? PLATAFORMA_POR_DEFECTO, 'plataforma');
  const multiplicador = exigirPrecio(
    tarifa.multiplicadorListaOficial ?? 1,
    'multiplicadorListaOficial',
  );

  const [insertada] = await tx<{ id: string }[]>`
    insert into tarifa_modelo (
      tenant_id, proveedor, modelo, euros_por_millon_entrada, euros_por_millon_salida,
      euros_por_millon_entrada_cache, plataforma, multiplicador_lista_oficial,
      vigente_desde, fuente
    ) values (
      ${tenantId}, ${proveedor}, ${modelo}, ${entradaPrecio}, ${salidaPrecio},
      ${cachePrecio}, ${plataforma}, ${multiplicador},
      ${comoIso(tarifa.vigenteDesde, 'vigenteDesde')}::timestamptz, ${fuente}
    )
    returning id
  `;
  if (!insertada) throw new Error('La tarifa no se insertó.');

  const entrada = await anotar(tx, tenantId, {
    actorTipo: 'plataforma',
    accion: ACCION_TARIFA_REGISTRADA,
    herramienta: proveedor,
    datosReferenciados: [
      { tipo: 'modelo', id: modelo, sistema: proveedor },
      { tipo: 'tarifa_modelo', id: insertada.id },
    ],
    resultado: 'exito',
  });

  await emitirEventoDeContador(tx, tenantId, {
    version: 1,
    motivo: 'tarifa',
    tareaRaizId: null,
    costeEuros: 0,
    numeroOrden: entrada.numeroOrden,
  });

  return { id: insertada.id, entrada };
}
