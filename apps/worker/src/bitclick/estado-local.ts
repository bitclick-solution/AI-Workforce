/**
 * Estado local que enlaza los guiones de Bitclick con su tenant ya sembrado.
 *
 * La siembra es idempotente por diseño (packages/db/RLS exige conocer ya el
 * `tenant_id` para leer la fila de `organizacion`: no hay forma de buscarla por
 * nombre sin salirse del aislamiento), así que el identificador del tenant se
 * guarda una vez, fuera de la base, en `.aiw-local/`, igual que el resto del
 * estado del entorno local (`.aiw-local/registros`, `.aiw-local/copias`).
 * `.aiw-local/` está en `.gitignore`: este fichero nunca se sube al repositorio,
 * y no lleva ningún secreto, solo identificadores.
 *
 * Sobrevive a `pnpm local:parar` y a `pnpm local:arrancar` porque nadie los toca;
 * solo `pnpm local:a-cero` borra `.aiw-local/` entero, y con él este fichero.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUTA_ESTADO_LOCAL } from './constantes.js';

export interface EstadoBitclick {
  tenantId: string;
  personaId: string;
  departamentoId: string;
  puestoId: string;
  versionPuestoId: string;
  conectorId: string;
  autorizacionId: string;
  sembradoEn: string;
}

/** Busca hacia arriba desde este módulo hasta el directorio con `pnpm-workspace.yaml`. */
export function raizDelRepositorio(desde: string = fileURLToPath(import.meta.url)): string {
  let actual = dirname(desde);
  for (let saltos = 0; saltos < 20; saltos += 1) {
    if (existsSync(join(actual, 'pnpm-workspace.yaml'))) return actual;
    const superior = dirname(actual);
    if (superior === actual) break;
    actual = superior;
  }
  throw new Error(
    'No se encuentra la raíz del repositorio (ningún directorio superior tiene pnpm-workspace.yaml).',
  );
}

function rutaCompleta(raiz: string = raizDelRepositorio()): string {
  return join(raiz, RUTA_ESTADO_LOCAL);
}

/** El estado guardado, o `undefined` si la siembra todavía no se ha ejecutado. */
export function leerEstadoBitclick(raiz?: string): EstadoBitclick | undefined {
  const ruta = rutaCompleta(raiz);
  if (!existsSync(ruta)) return undefined;
  return JSON.parse(readFileSync(ruta, 'utf8')) as EstadoBitclick;
}

export function guardarEstadoBitclick(estado: EstadoBitclick, raiz?: string): void {
  const ruta = rutaCompleta(raiz);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, `${JSON.stringify(estado, null, 2)}\n`, 'utf8');
}

export const MENSAJE_SIN_SIEMBRA =
  `No hay estado local en ${RUTA_ESTADO_LOCAL}: ejecuta primero ` +
  '`pnpm --filter @aiw/worker bitclick:sembrar`.';
