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

/** Lo que se firma. La entrada guardada añade el identificador, que no entra en el hash. */
export interface ContenidoEntrada {
  tenantId: string;
  numeroOrden: number;
  creadoEn: Date;
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

export function calcularHash(contenido: ContenidoEntrada, hashAnterior: string): string {
  if (!/^[0-9a-f]{64}$/.test(hashAnterior)) {
    throw new Error(`Hash anterior no válido: ${hashAnterior}`);
  }
  if (!Number.isInteger(contenido.numeroOrden) || contenido.numeroOrden < 1) {
    throw new Error(`Número de orden no válido: ${contenido.numeroOrden}`);
  }
  const canonico = serializarCanonico({
    accion: contenido.accion,
    actorId: contenido.actorId ?? null,
    actorTipo: contenido.actorTipo,
    aprobadaPorPersonaId: contenido.aprobadaPorPersonaId ?? null,
    cambioDeNivel: contenido.cambioDeNivel ?? null,
    costeEuros: normalizarImporte(contenido.costeEuros),
    creadoEn: contenido.creadoEn,
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
  return createHash('sha256').update(canonico, 'utf8').digest('hex');
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
    const calculado = calcularHash(eslabon, anterior);
    if (calculado !== eslabon.hash) {
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
