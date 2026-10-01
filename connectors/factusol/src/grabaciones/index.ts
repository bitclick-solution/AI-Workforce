/**
 * Respuestas grabadas de Factusol MCP.
 *
 * Hacen determinista la integración continua, que no alcanza Factusol: el mismo
 * cuerpo de prueba corre contra la instancia real cuando hay entorno y contra estas
 * respuestas cuando no. Los datos son inventados, con la forma exacta del informe
 * del Probador; regrabarlas es sustituir el JSON, no tocar el código.
 */
import { readFileSync } from 'node:fs';

import type { Grabaciones } from '../cliente.js';
import type { ResolutorDeVencimiento } from '../herramientas.js';

export const FICHERO_GRABACIONES = new URL('./factusol-pruebas.json', import.meta.url);

/** Día en el que se grabaron: las pruebas fijan el reloj aquí para que cuadren los días vencida. */
export const DIA_DE_LA_GRABACION = new Date('2026-09-21T09:00:00.000Z');

export function cargarGrabaciones(): Grabaciones {
  const crudo: unknown = JSON.parse(readFileSync(FICHERO_GRABACIONES, 'utf8'));
  const entradas = Object.entries(crudo as Record<string, unknown>).filter(
    ([clave, valor]) => !clave.startsWith('_') && Array.isArray(valor),
  );
  return Object.fromEntries(entradas) as Grabaciones;
}

/**
 * Resolutor de pruebas: plazo fijo de 30 días desde la fecha de la factura.
 *
 * Solo para pruebas y demostración sobre grabaciones. NO es la regla de negocio:
 * el vencimiento real sale de la forma de pago, aún sin informe (ver la
 * especificación, «Mapeo con Factusol MCP 3.4.7», punto 6).
 */
export const vencimientoDePrueba: ResolutorDeVencimiento = {
  derivar: (factura) => {
    const fecha = new Date(`${factura.fecha}T00:00:00.000Z`);
    fecha.setUTCDate(fecha.getUTCDate() + 30);
    return Promise.resolve(fecha.toISOString().slice(0, 10));
  },
};
