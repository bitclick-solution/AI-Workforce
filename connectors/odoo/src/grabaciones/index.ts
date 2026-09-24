/**
 * Respuestas grabadas del MCP dinámico.
 *
 * Es lo que hace determinista la integración continua, que no alcanza Odoo: el
 * mismo cuerpo de prueba corre contra la instancia real cuando hay entorno y
 * contra estas respuestas cuando no. Los datos son inventados y no hay ni un
 * dato personal real; regrabarlas es sustituir el JSON, no tocar el código.
 */
import { readFileSync } from 'node:fs';

import type { Grabaciones } from '../cliente.js';

export const FICHERO_GRABACIONES = new URL('./odoo-pruebas.json', import.meta.url);

/** Día en el que se grabaron: las pruebas fijan el reloj aquí para que cuadren los días vencida. */
export const DIA_DE_LA_GRABACION = new Date('2026-09-21T09:00:00.000Z');

export function cargarGrabaciones(): Grabaciones {
  const crudo: unknown = JSON.parse(readFileSync(FICHERO_GRABACIONES, 'utf8'));
  const entradas = Object.entries(crudo as Record<string, unknown>).filter(
    ([clave, valor]) => !clave.startsWith('_') && Array.isArray(valor),
  );
  return Object.fromEntries(entradas) as Grabaciones;
}
