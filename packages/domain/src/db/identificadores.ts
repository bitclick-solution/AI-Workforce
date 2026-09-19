/**
 * UUID v7 en la aplicación.
 *
 * La base lo genera por defecto con `uuid_generar_v7()`, pero a veces el
 * identificador hace falta antes de insertar: la raíz del tenant, por ejemplo, se
 * crea con el tenant ya fijado en la sesión, así que el valor se conoce antes.
 *
 * Formato: 48 bits de milisegundos desde el epoch, versión 7, 74 bits aleatorios.
 * Los identificadores crecen con el tiempo, que es lo que evita fragmentar índices.
 */
import { randomBytes } from 'node:crypto';

export function uuidV7(momento: Date = new Date()): string {
  const bytes = randomBytes(16);
  const milisegundos = BigInt(momento.getTime());

  for (let i = 0; i < 6; i += 1) {
    bytes[5 - i] = Number((milisegundos >> BigInt(8 * i)) & 0xffn);
  }
  // Versión 7 en los cuatro bits altos del séptimo byte.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // Variante RFC 4122 en los dos bits altos del noveno byte.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Momento en el que se generó un UUID v7. Sirve para ordenar y para depurar. */
export function momentoDeUuidV7(uuid: string): Date {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return new Date(Number(BigInt(`0x${hex}`)));
}
