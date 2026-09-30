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

/**
 * Argumento listo para `cmd.exe`: entre comillas si tiene espacios o comillas.
 * Con `shell: true`, Node solo une mandato y argumentos con un espacio (no cita
 * nada por su cuenta, ni siquiera con `shell: true`); como los argumentos con los
 * que este módulo llama a pnpm son siempre fijos (nunca los escribe quien invoca
 * el comando), no hay inyección que temer, pero se citan igual para que una ruta
 * con espacios no se parta en dos argumentos.
 */
function citarArgumentoWindows(argumento) {
  const texto = String(argumento);
  return /[\s"]/.test(texto) ? `"${texto.replace(/"/g, '\\"')}"` : texto;
}

/**
 * `{ mandato, argumentos, opciones }` para lanzar `pnpm ...` igual en Windows que
 * en Linux o macOS. Desde la corrección de seguridad de abril de 2024
 * (CVE-2024-27980), Node se niega a lanzar un `.cmd` o un `.ps1` sin
 * `shell: true` (falla con EINVAL); en Windows, pnpm casi nunca es un `.exe`
 * nativo, así que hace falta. `npm_execpath` sale vacío bajo `pnpm exec` en
 * algunas máquinas (la de Jesús, por ejemplo), así que no sirve para resolverlo.
 * La usan por igual `lanzarProceso`, `local-arrancar.mjs` y
 * `local-requisitos.mjs`: una sola resolución para lanzar pnpm de verdad y para
 * comprobar que se puede lanzar, que si no podrían no estar de acuerdo.
 */
export function comandoPnpm(argumentos, { plataforma = process.platform } = {}) {
  if (plataforma !== 'win32') return { mandato: 'pnpm', argumentos, opciones: {} };
  return {
    mandato: 'pnpm',
    argumentos: argumentos.map(citarArgumentoWindows),
    opciones: { shell: true },
  };
}

/**
 * Valor de una variable de entorno con la misma prioridad que usa Docker Compose
 * para `--env-file`: el entorno del proceso (lo que fija un `env:` de la CI, por
 * ejemplo para esquivar un puerto ya ocupado en un ejecutor compartido) gana al
 * valor de `.env`, y ese gana al valor por defecto. Sin esto, un `env:` del job
 * cambia el puerto real del contenedor pero deja a este script comprobando y
 * componiendo con el puerto de `.env`, que ya no es el que se está usando.
 */
export function valorEntorno(env, nombre, porDefecto) {
  return process.env[nombre]?.trim() || env[nombre] || porDefecto;
}

/** Cadena de conexión compuesta a partir de .env (o su variable de entorno); nunca se escribe en ningún fichero. */
export function urlBaseDeDatos(env) {
  const usuario = valorEntorno(env, 'POSTGRES_USER', 'postgres');
  const clave = env.POSTGRES_PASSWORD;
  const puerto = valorEntorno(env, 'POSTGRES_PORT', '5432');
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
export function lanzarProceso(
  nombre,
  mandato,
  argumentos,
  { env, cwd = raiz, plataforma = process.platform } = {},
) {
  asegurarCarpetaLocal();
  const rutaRegistro = join(rutaRegistros, `${nombre}.log`);
  const descriptor = openSync(rutaRegistro, 'w');
  const resolucion =
    mandato === 'pnpm'
      ? comandoPnpm(argumentos, { plataforma })
      : { mandato, argumentos, opciones: {} };
  const flujo = spawn(resolucion.mandato, resolucion.argumentos, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', descriptor, descriptor],
    ...resolucion.opciones,
  });
  flujo.unref();
  return { nombre, proceso: flujo, rutaRegistro };
}

/**
 * Entorno final de un proceso lanzado por estos guiones: el `.env` ya leído,
 * encima lo que de verdad viene exportado del proceso que invoca (nunca al
 * revés — fallo 6: antes `.env` pisaba el entorno del proceso), y por último lo
 * que este mandato calcula en este arranque (`DATABASE_URL`, la cola de
 * Temporal, los puertos ya resueltos…), que no es ajustable desde fuera porque
 * son hechos de esta ejecución, no preferencias de quien la lanza.
 */
export function entornoDeProceso(env, calculado = {}) {
  return { ...env, ...process.env, ...calculado };
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

/**
 * Para el árbol de procesos de un pid (fallo 1): en POSIX, con `SIGTERM` a su
 * grupo entero (pnpm arrastra tsx o next); Windows no tiene grupos de procesos,
 * así que ahí `process.kill(-pid)` no paraba nada y el error se tragaba en
 * silencio. En Windows, `taskkill /PID <pid> /T /F` es la forma documentada de
 * parar el árbol completo sin necesitar un grupo. `plataforma` y `ejecutar`/
 * `matar` son inyectables para probar los dos sentidos sin Windows a mano.
 */
export function pararArbolDeProcesos(
  pid,
  { plataforma = process.platform, matar = process.kill, ejecutar = spawnSync } = {},
) {
  if (plataforma === 'win32') {
    const resultado = ejecutar('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    if (resultado.status === 0) return { parado: true };
    const salida = `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`;
    // Código 128: taskkill no encuentra ese PID, ya estaba parado.
    if (resultado.status === 128 || /no se encontr|not found/i.test(salida)) {
      return { parado: true };
    }
    return { parado: false, motivo: salida.trim() || `taskkill salió con ${resultado.status}` };
  }
  try {
    matar(-pid, 'SIGTERM');
    return { parado: true };
  } catch (error) {
    if (error.code === 'ESRCH') return { parado: true };
    return { parado: false, motivo: error.message };
  }
}

/** Para cada proceso registrado su árbol entero. Si alguno no para, lo dice y no borra `procesos.json`. */
export function pararProcesosRegistrados({ plataforma = process.platform } = {}) {
  const procesos = leerProcesos();
  let todosParados = true;
  for (const { nombre, pid } of procesos) {
    const resultado = pararArbolDeProcesos(pid, { plataforma });
    if (resultado.parado) {
      console.log(`  parado ${nombre} (pid ${pid})`);
    } else {
      todosParados = false;
      console.warn(`  no se pudo parar ${nombre} (pid ${pid}): ${resultado.motivo}`);
    }
  }
  if (!todosParados) {
    console.warn('  algún proceso no se pudo parar: no se borra procesos.json.');
    return { todosParados };
  }
  if (existsSync(rutaProcesos)) rmSync(rutaProcesos);
  return { todosParados };
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
