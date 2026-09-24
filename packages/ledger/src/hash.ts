/**
 * Hash encadenado del libro de auditoría.
 *
 * Cada entrada incluye el hash de la anterior del mismo tenant. Alterar una entrada
 * rompe el resto de la cadena, y la verificación lo detecta. La serialización es
 * canónica —claves ordenadas y fechas en ISO— para que el mismo contenido dé siempre
 * el mismo hash, aquí y dentro de seis años.
 */
import { createHash } from 'node:crypto';

/** Primer eslabón de la cadena de un tenant. */
export const HASH_GENESIS = '0'.repeat(64);

export interface DatoReferenciado {
  tipo: string;
  id: string;
  sistema?: string | undefined;
}

/**
 * Lo que da el cliente de `postgres` para una columna `timestamptz`.
 *
 * Un cliente crudo la analiza a `Date`. `drizzle-orm/postgres-js` sustituye, en el
 * mismo objeto de cliente que recibe, los analizadores de los tipos de fecha (1082,
 * 1083, 1114, 1184 y otros) por la identidad, así que ese mismo cliente da el texto
 * de Postgres tal cual —por ejemplo `2026-09-20 12:45:00.123+00`—. Las dos son la
 * misma marca de tiempo; `normalizarFecha` las hace iguales antes de firmar.
 */
export type FechaEntrada = Date | string;

/** Lo que se firma. La entrada guardada añade el identificador, que no entra en el hash. */
export interface ContenidoEntrada {
  tenantId: string;
  numeroOrden: number;
  creadoEn: FechaEntrada;
  actorTipo: 'persona' | 'agente' | 'plataforma' | 'sistema';
  actorId?: string | null | undefined;
  puestoId?: string | null | undefined;
  versionPuestoId?: string | null | undefined;
  tareaId?: string | null | undefined;
  pasoId?: string | null | undefined;
  accion: string;
  herramienta?: string | null | undefined;
  datosReferenciados: readonly DatoReferenciado[];
  resultado: 'exito' | 'error' | 'rechazado' | 'parcial';
  costeEuros: number;
  duracionMs: number;
  aprobadaPorPersonaId?: string | null | undefined;
  leccionAplicadaId?: string | null | undefined;
  nivelAplicado?: 'n0' | 'n1' | 'n2' | 'n3' | null | undefined;
  cambioDeNivel?: unknown;
}

/** Serialización estable: objetos con claves ordenadas, fechas en ISO, `null` explícito. */
export function serializarCanonico(valor: unknown): string {
  if (valor === undefined || valor === null) return 'null';
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`;
  if (typeof valor === 'object') {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([clave, v]) => `${JSON.stringify(clave)}:${serializarCanonico(v)}`);
    return `{${entradas.join(',')}}`;
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) {
      throw new Error('El libro de auditoría no admite números no finitos.');
    }
    return JSON.stringify(valor);
  }
  return JSON.stringify(valor);
}

/** Normaliza el importe a cuatro decimales, que es lo que guarda la columna. */
export function normalizarImporte(euros: number): string {
  if (!Number.isFinite(euros)) {
    throw new Error('Importe no finito en la entrada de auditoría.');
  }
  return euros.toFixed(4);
}

/** El texto que da Postgres para un `timestamptz`: `AAAA-MM-DD HH:MI:SS[.fracción][±TZ]`. */
const TEXTO_TIMESTAMPTZ =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:([+-])(\d{2})(?::?(\d{2}))?)?$/;

/**
 * Da siempre el mismo `Date` para la misma marca de tiempo, venga como `Date` —
 * cliente crudo de `postgres`— o como el texto de Postgres sin analizar —cliente al
 * que `drizzle-orm/postgres-js` le ha sustituido el analizador—. Sin desplazamiento
 * de zona en el texto se asume UTC, que es como arranca la sesión de la aplicación.
 */
export function normalizarFecha(valor: FechaEntrada): Date {
  if (valor instanceof Date) return valor;
  const texto = valor.trim().replace(/Z$/, '+00');
  const encaje = TEXTO_TIMESTAMPTZ.exec(texto);
  if (!encaje) {
    throw new Error(`Fecha de entrada de auditoría no reconocida: ${valor}`);
  }
  const [, anio, mes, dia, hora, minuto, segundo, fraccion, signo, horaZona, minutoZona] = encaje;
  const milisegundos = fraccion ? Math.round(Number(`0.${fraccion}`) * 1000) : 0;
  const desplazamientoMin =
    signo === undefined
      ? 0
      : (signo === '-' ? -1 : 1) * (Number(horaZona) * 60 + Number(minutoZona ?? '0'));
  const utcMs =
    Date.UTC(
      Number(anio),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo),
      milisegundos,
    ) -
    desplazamientoMin * 60_000;
  const fecha = new Date(utcMs);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`Fecha de entrada de auditoría no reconocida: ${valor}`);
  }
  return fecha;
}

function validarCabecera(contenido: ContenidoEntrada, hashAnterior: string): void {
  if (!/^[0-9a-f]{64}$/.test(hashAnterior)) {
    throw new Error(`Hash anterior no válido: ${hashAnterior}`);
  }
  if (!Number.isInteger(contenido.numeroOrden) || contenido.numeroOrden < 1) {
    throw new Error(`Número de orden no válido: ${contenido.numeroOrden}`);
  }
}

function serializarContenido(
  contenido: ContenidoEntrada,
  hashAnterior: string,
  creadoEn: FechaEntrada,
): string {
  return serializarCanonico({
    accion: contenido.accion,
    actorId: contenido.actorId ?? null,
    actorTipo: contenido.actorTipo,
    aprobadaPorPersonaId: contenido.aprobadaPorPersonaId ?? null,
    cambioDeNivel: contenido.cambioDeNivel ?? null,
    costeEuros: normalizarImporte(contenido.costeEuros),
    creadoEn,
    datosReferenciados: contenido.datosReferenciados,
    duracionMs: contenido.duracionMs,
    hashAnterior,
    herramienta: contenido.herramienta ?? null,
    leccionAplicadaId: contenido.leccionAplicadaId ?? null,
    nivelAplicado: contenido.nivelAplicado ?? null,
    numeroOrden: contenido.numeroOrden,
    pasoId: contenido.pasoId ?? null,
    puestoId: contenido.puestoId ?? null,
    resultado: contenido.resultado,
    tareaId: contenido.tareaId ?? null,
    tenantId: contenido.tenantId,
    versionPuestoId: contenido.versionPuestoId ?? null,
  });
}

/**
 * Regla canónica: `creadoEn` se normaliza a ISO 8601 en UTC antes de firmar, así que
 * el hash no depende de qué cliente escribió o qué cliente verifica. Rige para toda
 * entrada anotada desde esta rebanada (serialización canónica del libro).
 */
export function calcularHash(contenido: ContenidoEntrada, hashAnterior: string): string {
  validarCabecera(contenido, hashAnterior);
  const canonico = serializarContenido(
    contenido,
    hashAnterior,
    normalizarFecha(contenido.creadoEn),
  );
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * Regla de antes de esta rebanada: firma `creadoEn` tal cual llega, sin normalizar.
 * Con un cliente crudo de `postgres` eso ya era ISO (un `Date` se serializa igual
 * con las dos reglas); con un cliente al que `drizzle-orm/postgres-js` le hubiera
 * sustituido el analizador, firmaba el texto de Postgres tal cual. Se conserva solo
 * para verificar entradas anotadas antes de esta rebanada — `verificarCadena` la usa
 * como segundo intento cuando la regla canónica no cuadra. Ninguna escritura nueva
 * la usa.
 */
export function calcularHashLegado(contenido: ContenidoEntrada, hashAnterior: string): string {
  validarCabecera(contenido, hashAnterior);
  const canonico = serializarContenido(contenido, hashAnterior, contenido.creadoEn);
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
}

/**
 * `true` si el hash guardado cuadra con el contenido, probando primero la regla
 * canónica y, si no cuadra, la regla de antes de esta rebanada. Así una entrada
 * antigua que no pasó por la normalización de `creadoEn` sigue verificando, y
 * cualquier otra alteración se sigue detectando con las dos reglas.
 */
export function hashCoincide(
  contenido: ContenidoEntrada,
  hashAnterior: string,
  hashGuardado: string,
): boolean {
  return (
    calcularHash(contenido, hashAnterior) === hashGuardado ||
    calcularHashLegado(contenido, hashAnterior) === hashGuardado
  );
}

export interface EslabonVerificable extends ContenidoEntrada {
  hash: string;
  hashAnterior: string | null;
}

export interface ResultadoVerificacion {
  valida: boolean;
  entradas: number;
  /** Número de orden del primer eslabón roto, si lo hay. */
  rotaEn?: number;
  motivo?: string;
}

/**
 * Recorre la cadena de un tenant en orden y comprueba cada eslabón.
 * Una cadena vacía es válida: el tenant todavía no ha hecho nada.
 */
export function verificarCadena(eslabones: readonly EslabonVerificable[]): ResultadoVerificacion {
  let anterior = HASH_GENESIS;
  let esperado = 1;

  for (const eslabon of eslabones) {
    if (eslabon.numeroOrden !== esperado) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `Falta la entrada ${esperado}: la cadena salta a ${eslabon.numeroOrden}.`,
      };
    }
    const hashAnteriorGuardado = eslabon.hashAnterior ?? HASH_GENESIS;
    if (hashAnteriorGuardado !== anterior) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `La entrada ${eslabon.numeroOrden} no encadena con la anterior.`,
      };
    }
    if (!hashCoincide(eslabon, anterior, eslabon.hash)) {
      return {
        valida: false,
        entradas: eslabones.length,
        rotaEn: eslabon.numeroOrden,
        motivo: `La entrada ${eslabon.numeroOrden} está alterada: el hash no cuadra.`,
      };
    }
    anterior = eslabon.hash;
    esperado += 1;
  }

  return { valida: true, entradas: eslabones.length };
}
