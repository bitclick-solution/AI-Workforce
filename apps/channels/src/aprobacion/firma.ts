/**
 * El enlace firmado del correo de aprobación.
 *
 * El token es una firma HMAC-SHA256 sin estado: `v1.<carga>.<firma>`, con la carga
 * en base64url. No se guarda nada en la base, porque no hay nada que guardar: la
 * firma prueba que el enlace lo emitimos nosotros, la caducidad va dentro de la
 * carga y el «un solo uso» lo impone la única de `decision_aprobacion`. Un token
 * aleatorio guardado con su hash haría lo mismo a cambio de una tabla nueva y, por
 * tanto, de una migración en zona crítica.
 *
 * Rotar la clave revoca todos los enlaces vivos, que es la revocación explícita que
 * pide la definición de hecho.
 *
 * La firma se calcula sobre el texto ya codificado y se comprueba **antes** de
 * interpretar la carga: así ningún dato del atacante llega al analizador.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Secreto } from '../secreto.js';

export const VERSION_TOKEN = 'v1';

/** La clave más corta que se acepta. Por debajo, un HMAC-SHA256 no aporta gran cosa. */
export const LONGITUD_MINIMA_CLAVE = 32;

/**
 * Lo que va dentro del enlace: a qué tenant pertenece, qué aprobación resuelve, de
 * qué tarea es y cuándo deja de servir. Nada más: el borrador es opaco y el resumen
 * legible se lee de la base, no del token, para que nadie pueda cambiar lo que la
 * página muestra manipulando el enlace.
 */
export interface CargaEnlace {
  tenantId: string;
  aprobacionId: string;
  tareaId: string;
  /** Segundos desde el epoch. Entero, para que la carga sea estable. */
  caducaEn: number;
}

export type MotivoTokenInvalido = 'formato' | 'version' | 'firma' | 'carga' | 'caducado';

export type VerificacionEnlace =
  | { valido: true; carga: CargaEnlace }
  | { valido: false; motivo: MotivoTokenInvalido; carga?: CargaEnlace };

/** Exige una clave de firma usable. Se llama al arrancar, no al firmar. */
export function exigirClaveDeFirma(valor: string | undefined, variable: string): Secreto {
  const clave = (valor ?? '').trim();
  if (clave.length === 0) {
    throw new Error(
      `Falta ${variable}: sin clave no se pueden firmar los enlaces de aprobación. ` +
        'Genérala en el entorno; en .env.example vale GENERAR.',
    );
  }
  if (clave.length < LONGITUD_MINIMA_CLAVE) {
    throw new Error(
      `${variable} es demasiado corta: ${clave.length} caracteres, y hacen falta ` +
        `${LONGITUD_MINIMA_CLAVE} como mínimo.`,
    );
  }
  return new Secreto(clave, variable);
}

function firmar(clave: Secreto, texto: string): string {
  return createHmac('sha256', clave.revelar()).update(texto, 'utf8').digest('base64url');
}

export interface OpcionesFirma {
  /** Cuándo deja de servir el enlace. */
  caducaEn: Date;
}

export function firmarEnlace(
  clave: Secreto,
  datos: Omit<CargaEnlace, 'caducaEn'>,
  opciones: OpcionesFirma,
): string {
  const carga: CargaEnlace = {
    tenantId: datos.tenantId,
    aprobacionId: datos.aprobacionId,
    tareaId: datos.tareaId,
    caducaEn: Math.floor(opciones.caducaEn.getTime() / 1000),
  };
  const cuerpo = `${VERSION_TOKEN}.${Buffer.from(JSON.stringify(carga), 'utf8').toString('base64url')}`;
  return `${cuerpo}.${firmar(clave, cuerpo)}`;
}

/**
 * Verifica el token y devuelve su carga.
 *
 * El orden importa: formato, versión, firma y solo entonces caducidad. Un token con
 * la firma mal nunca llega a decir nada sobre la aprobación, ni siquiera que
 * caducó, porque no hay razón para creer lo que lleva dentro.
 */
export function verificarEnlace(
  clave: Secreto,
  token: string,
  ahora: Date = new Date(),
): VerificacionEnlace {
  const partes = token.split('.');
  if (partes.length !== 3) return { valido: false, motivo: 'formato' };
  const [version, cargaCodificada, firmaRecibida] = partes as [string, string, string];
  if (version !== VERSION_TOKEN) return { valido: false, motivo: 'version' };
  if (cargaCodificada.length === 0 || firmaRecibida.length === 0) {
    return { valido: false, motivo: 'formato' };
  }

  const esperada = firmar(clave, `${version}.${cargaCodificada}`);
  if (!igualEnTiempoConstante(esperada, firmaRecibida)) {
    return { valido: false, motivo: 'firma' };
  }

  const carga = interpretarCarga(cargaCodificada);
  if (!carga) return { valido: false, motivo: 'carga' };
  if (carga.caducaEn * 1000 <= ahora.getTime()) {
    // Se devuelve la carga: el enlace es nuestro y la persona a la que se lo
    // mandamos merece leer «caducó» en vez de «no válido».
    return { valido: false, motivo: 'caducado', carga };
  }
  return { valido: true, carga };
}

/**
 * Compara sin filtrar el resultado por el tiempo que tarda.
 *
 * `timingSafeEqual` lanza si las longitudes no coinciden, así que se comprueban
 * antes: una firma de otra longitud no es igual, y decirlo no filtra nada.
 */
export function igualEnTiempoConstante(a: string, b: string): boolean {
  const izquierda = Buffer.from(a, 'utf8');
  const derecha = Buffer.from(b, 'utf8');
  if (izquierda.length !== derecha.length) return false;
  return timingSafeEqual(izquierda, derecha);
}

function interpretarCarga(codificada: string): CargaEnlace | null {
  try {
    const crudo: unknown = JSON.parse(Buffer.from(codificada, 'base64url').toString('utf8'));
    if (typeof crudo !== 'object' || crudo === null) return null;
    const { tenantId, aprobacionId, tareaId, caducaEn } = crudo as Record<string, unknown>;
    if (!textoNoVacio(tenantId) || !textoNoVacio(aprobacionId) || !textoNoVacio(tareaId)) {
      return null;
    }
    if (typeof caducaEn !== 'number' || !Number.isFinite(caducaEn)) return null;
    return { tenantId, aprobacionId, tareaId, caducaEn };
  } catch {
    return null;
  }
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.length > 0;
}

/** Compone la URL del enlace. La base viene de la configuración, no de la petición. */
export function urlDelEnlace(urlPublica: string, token: string): string {
  const base = urlPublica.endsWith('/') ? urlPublica.slice(0, -1) : urlPublica;
  return `${base}/aprobaciones/${encodeURIComponent(token)}`;
}
