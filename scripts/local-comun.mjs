// Utilidades compartidas por los comandos `pnpm local:*` (arrancar, parar, actualizar,
// a-cero, copia, restaurar). Todo lo que tocan estos comandos vive bajo `.aiw-local/`
// en la raíz del repositorio: registros y el registro de procesos arrancados. Esa
// carpeta nunca se versiona (ver .gitignore) y `local:a-cero` la borra entera.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  asegurarEnv,
  completarEnv,
  composeArgs,
  leerEnv,
  migrarEnv,
  raiz,
  rutaEnv,
} from './env-local.mjs';

export { asegurarEnv, completarEnv, composeArgs, leerEnv, migrarEnv, raiz, rutaEnv };

export const raizLocal = join(raiz, '.aiw-local');
export const rutaProcesos = join(raizLocal, 'procesos.json');
export const rutaRegistros = join(raizLocal, 'registros');
export const rutaCopias = join(raizLocal, 'copias');

export function asegurarCarpetaLocal() {
  mkdirSync(rutaRegistros, { recursive: true });
  mkdirSync(rutaCopias, { recursive: true });
}

/** `--nombre` o `--nombre=valor` en los argumentos de la CLI. */
export function tieneBandera(argumentos, nombre) {
  return argumentos.some((a) => a === `--${nombre}` || a.startsWith(`--${nombre}=`));
}

export function valorDeBandera(argumentos, nombre) {
  const conIgual = argumentos.find((a) => a.startsWith(`--${nombre}=`));
  if (conIgual) return conIgual.slice(nombre.length + 3);
  const indice = argumentos.indexOf(`--${nombre}`);
  return indice >= 0 ? argumentos[indice + 1] : undefined;
}

export function tokenAleatorio() {
  return randomBytes(24).toString('hex');
}

/** Cadena de conexión compuesta a partir de .env; nunca se escribe en ningún fichero. */
export function urlBaseDeDatos(env) {
  const usuario = env.POSTGRES_USER || 'postgres';
  const clave = env.POSTGRES_PASSWORD;
  const puerto = env.POSTGRES_PORT || '5432';
  if (!clave) {
    throw new Error('Falta POSTGRES_PASSWORD en .env. Ejecuta primero `pnpm local:arrancar`.');
  }
  return `postgresql://${usuario}:${encodeURIComponent(clave)}@127.0.0.1:${puerto}/aiworkforce`;
}

/** true si algo ya escucha en ese puerto de 127.0.0.1 (puerto ocupado). */
export function puertoOcupado(puerto, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resuelve) => {
    const zocalo = createConnection({ port: Number(puerto), host, timeout: timeoutMs });
    zocalo.once('connect', () => {
      zocalo.destroy();
      resuelve(true);
    });
    zocalo.once('timeout', () => {
      zocalo.destroy();
      resuelve(false);
    });
    zocalo.once('error', () => resuelve(false));
  });
}

/** Espera a que un puerto empiece a aceptar conexiones, o lanza al agotar el plazo. */
export async function esperarPuerto(puerto, { host = '127.0.0.1', timeoutMs = 60_000 } = {}) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await puertoOcupado(puerto, host, 1000)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El puerto ${puerto} no respondió en ${Math.round(timeoutMs / 1000)} s.`);
}

/** Estado de los servicios del Compose: nombre, estado y salud si la tiene. */
export function estadoServicios() {
  const resultado = spawnSync('docker', [...composeArgs, 'ps', '--format', 'json'], {
    cwd: raiz,
    encoding: 'utf8',
  });
  if (resultado.status !== 0) return [];
  return resultado.stdout
    .split('\n')
    .filter(Boolean)
    .map((linea) => {
      try {
        return JSON.parse(linea);
      } catch {
        return undefined;
      }
    })
    .filter((s) => s !== undefined);
}

/**
 * Lanza un proceso en su propio grupo, con la salida escrita directamente al
 * fichero de registro por un descriptor, nunca por una tubería que pase por este
 * proceso: con `detached` y `unref()`, este proceso puede terminar en cuanto quiera
 * sin arrastrarse el hijo detrás, pero si su salida fuera una tubería ('pipe') leída
 * aquí, el hijo se quedaría escribiendo a un lector que ya no existe (EPIPE) en
 * cuanto este proceso terminara — es justo lo que hacía que `local:arrancar` no
 * terminara nunca en la CI: la tubería mantenía vivo el bucle de eventos hasta que
 * el job la cortaba por el plazo máximo.
 */
export function lanzarProceso(nombre, mandato, argumentos, { env, cwd = raiz } = {}) {
  asegurarCarpetaLocal();
  const rutaRegistro = join(rutaRegistros, `${nombre}.log`);
  const descriptor = openSync(rutaRegistro, 'w');
  const flujo = spawn(mandato, argumentos, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', descriptor, descriptor],
  });
  flujo.unref();
  return { nombre, proceso: flujo, rutaRegistro };
}

/**
 * Espera a que el fichero de registro de un proceso lanzado con `lanzarProceso`
 * contenga lo que `comprobar` busca, leyéndolo por sondeo en vez de por tubería
 * (ver la nota de `lanzarProceso`: aquí no hay tubería que leer).
 */
export async function esperarEnFichero(
  rutaRegistro,
  proceso,
  comprobar,
  { timeoutMs = 90_000, intervaloMs = 500 } = {},
) {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (proceso.exitCode !== null && proceso.exitCode !== undefined) {
      throw new Error(
        `El proceso terminó (código ${proceso.exitCode}) antes de estar listo. Mira el registro.`,
      );
    }
    if (existsSync(rutaRegistro)) {
      const encontrado = comprobar(readFileSync(rutaRegistro, 'utf8'));
      if (encontrado !== undefined) return encontrado;
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  throw new Error('Se agotó el plazo esperando la salida del proceso. Mira el registro.');
}

export function leerProcesos() {
  if (!existsSync(rutaProcesos)) return [];
  try {
    return JSON.parse(readFileSync(rutaProcesos, 'utf8'));
  } catch {
    return [];
  }
}

export function guardarProcesos(procesos) {
  asegurarCarpetaLocal();
  writeFileSync(rutaProcesos, JSON.stringify(procesos, null, 2));
}

export function registrarProceso(nombre, pid, rutaRegistro) {
  const procesos = leerProcesos().filter((p) => p.nombre !== nombre);
  procesos.push({ nombre, pid, rutaRegistro, iniciadoEn: new Date().toISOString() });
  guardarProcesos(procesos);
}

/** Para cada proceso registrado, su grupo entero (pnpm arrastra tsx o next). */
export function pararProcesosRegistrados() {
  const procesos = leerProcesos();
  for (const { nombre, pid } of procesos) {
    try {
      process.kill(-pid, 'SIGTERM');
      console.log(`  parado ${nombre} (pid ${pid})`);
    } catch (error) {
      if (error.code !== 'ESRCH') console.warn(`  no se pudo parar ${nombre}: ${error.message}`);
    }
  }
  if (existsSync(rutaProcesos)) rmSync(rutaProcesos);
}

/** Confirmación interactiva de una sola letra; en modo no interactivo exige `--si`. */
export async function confirmar(pregunta, argumentos) {
  if (tieneBandera(argumentos, 'si')) return true;
  if (tieneBandera(argumentos, 'no-interactivo') || !process.stdin.isTTY) {
    console.error('Modo no interactivo: añade --si para confirmar sin preguntar.');
    return false;
  }
  const lector = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = await new Promise((resuelve) =>
    lector.question(`${pregunta} [sí/NO] `, resuelve),
  );
  lector.close();
  return ['si', 'sí', 's', 'y', 'yes'].includes(respuesta.trim().toLowerCase());
}
