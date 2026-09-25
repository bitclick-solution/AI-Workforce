/**
 * Migraciones versionadas y reversibles.
 *
 * Sin cambios a mano en ningún entorno (ADR-007). Cada migración es un fichero SQL
 * en `drizzle/` con su reverso en `drizzle/reverso/`; lo aplicado queda en la tabla
 * `migracion_aplicada` con la huella del fichero, para detectar que alguien editó
 * una migración ya aplicada.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type postgres from 'postgres';

const SEPARADOR = '--> statement-breakpoint';

export interface Migracion {
  nombre: string;
  ruta: string;
  rutaReverso: string;
}

export const MIGRACIONES: readonly Migracion[] = [
  {
    nombre: '0000_inicial',
    ruta: fileURLToPath(new URL('../drizzle/0000_inicial.sql', import.meta.url)),
    rutaReverso: fileURLToPath(new URL('../drizzle/reverso/0000_inicial.sql', import.meta.url)),
  },
  {
    nombre: '0001_contador_uso_de_modelos',
    ruta: fileURLToPath(new URL('../drizzle/0001_contador_uso_de_modelos.sql', import.meta.url)),
    rutaReverso: fileURLToPath(
      new URL('../drizzle/reverso/0001_contador_uso_de_modelos.sql', import.meta.url),
    ),
  },
  {
    nombre: '0002_indice_unico_de_promocion',
    ruta: fileURLToPath(new URL('../drizzle/0002_indice_unico_de_promocion.sql', import.meta.url)),
    rutaReverso: fileURLToPath(
      new URL('../drizzle/reverso/0002_indice_unico_de_promocion.sql', import.meta.url),
    ),
  },
];

export function huellaDe(contenido: string): string {
  return createHash('sha256').update(contenido, 'utf8').digest('hex');
}

/** Trocea el fichero en sentencias. Los cuerpos de función con `$$` quedan enteros. */
export function sentenciasDe(sql: string): string[] {
  return sql
    .split(SEPARADOR)
    .map((trozo) => trozo.trim())
    .filter((trozo) => trozo.length > 0 && !esSoloComentario(trozo));
}

function esSoloComentario(trozo: string): boolean {
  return trozo
    .split('\n')
    .every((linea) => linea.trim().length === 0 || linea.trim().startsWith('--'));
}

async function tablaDeRegistroExiste(cliente: postgres.Sql): Promise<boolean> {
  const [fila] = await cliente<{ existe: boolean }[]>`
    select to_regclass('public.migracion_aplicada') is not null as existe
  `;
  return fila?.existe ?? false;
}

async function nombresAplicados(cliente: postgres.Sql): Promise<Set<string>> {
  if (!(await tablaDeRegistroExiste(cliente))) return new Set();
  const filas = await cliente<{ nombre: string; huella: string }[]>`
    select nombre, huella from migracion_aplicada
  `;
  return new Set(filas.map((f) => f.nombre));
}

export interface ResultadoMigracion {
  aplicadas: string[];
  yaAplicadas: string[];
}

/** Aplica las migraciones pendientes. Es idempotente: repetirla no cambia nada. */
export async function aplicarMigraciones(cliente: postgres.Sql): Promise<ResultadoMigracion> {
  const aplicadas: string[] = [];
  const yaAplicadas: string[] = [];
  const registradas = await nombresAplicados(cliente);

  for (const migracion of MIGRACIONES) {
    if (registradas.has(migracion.nombre)) {
      yaAplicadas.push(migracion.nombre);
      continue;
    }
    const contenido = readFileSync(migracion.ruta, 'utf8');
    const huella = huellaDe(contenido);
    await cliente.begin(async (tx) => {
      for (const sentencia of sentenciasDe(contenido)) {
        await tx.unsafe(sentencia);
      }
      await tx`
        insert into migracion_aplicada (nombre, huella)
        values (${migracion.nombre}, ${huella})
      `;
    });
    aplicadas.push(migracion.nombre);
  }
  return { aplicadas, yaAplicadas };
}

/** Deshace las migraciones aplicadas, de la última a la primera. */
export async function revertirMigraciones(cliente: postgres.Sql): Promise<string[]> {
  const revertidas: string[] = [];
  const registradas = await nombresAplicados(cliente);

  for (const migracion of [...MIGRACIONES].reverse()) {
    if (!registradas.has(migracion.nombre)) continue;
    const contenido = readFileSync(migracion.rutaReverso, 'utf8');
    await cliente.begin(async (tx) => {
      for (const sentencia of sentenciasDe(contenido)) {
        await tx.unsafe(sentencia);
      }
    });
    revertidas.push(migracion.nombre);
  }
  return revertidas;
}

/**
 * Comprueba que ninguna migración ya aplicada cambió de contenido.
 * Editar una migración aplicada es deriva entre entornos, que es lo que el ADR evita.
 */
export async function comprobarHuellas(cliente: postgres.Sql): Promise<string[]> {
  if (!(await tablaDeRegistroExiste(cliente))) return [];
  const filas = await cliente<{ nombre: string; huella: string }[]>`
    select nombre, huella from migracion_aplicada
  `;
  const problemas: string[] = [];
  for (const fila of filas) {
    const migracion = MIGRACIONES.find((m) => m.nombre === fila.nombre);
    if (!migracion) {
      problemas.push(`Migración aplicada que ya no existe en el repositorio: ${fila.nombre}`);
      continue;
    }
    const huella = huellaDe(readFileSync(migracion.ruta, 'utf8'));
    if (huella !== fila.huella) {
      problemas.push(`La migración ${fila.nombre} cambió después de aplicarse`);
    }
  }
  return problemas;
}
