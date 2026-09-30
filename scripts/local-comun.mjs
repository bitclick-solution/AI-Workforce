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
    detached: separarDelPadre(plataforma, resolucion.opciones),
    stdio: ['ignore', descriptor, descriptor],
    ...resolucion.opciones,
  });
  flujo.unref();
  return { nombre, proceso: flujo, rutaRegistro };
}

/**
 * Si el proceso lanzado debe separarse del todo del padre (`detached`). Fallo
 * del Probador tras el #50: en win32, combinar `detached: true` con
 * `shell: true` (necesario para lanzar pnpm ahí, ver `comandoPnpm`) pierde la
 * salida del hijo — el fichero de registro queda a 0 bytes aunque el proceso
 * funcione de verdad por debajo. `unref()` ya deja que este proceso termine
 * sin esperar al hijo (la razón original de `detached`, ver la nota de
 * `lanzarProceso`); en Windows, sin `shell`, no hace falta separarlo también.
 */
export function separarDelPadre(plataforma, opciones) {
  return !(plataforma === 'win32' && opciones.shell);
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

/**
 * `puerto` es opcional (el worker de la demo no escucha ninguno): con él,
 * `pararServicio` puede comprobar que de verdad ha dejado de escuchar en vez de
 * fiarse solo de lo que diga `taskkill`/`kill` (criterio 3 y segundo seguimiento
 * del Probador), y `comprobarRequisitos` puede reconocer que ese puerto es suyo.
 */
export function registrarProceso(nombre, pid, rutaRegistro, puerto) {
  const procesos = leerProcesos().filter((p) => p.nombre !== nombre);
  procesos.push({ nombre, pid, rutaRegistro, puerto, iniciadoEn: new Date().toISOString() });
  guardarProcesos(procesos);
}

/**
 * true si ese pid sigue vivo. En POSIX, la señal 0 no mata nada: solo comprueba
 * que el proceso existe y es accesible. En Windows no hay señal 0, así que se usa
 * `tasklist` filtrado por PID (misma familia de herramientas que `taskkill`).
 * Inyectable para probarla en los dos sentidos sin depender de la plataforma real.
 */
export function procesoVivo(
  pid,
  { plataforma = process.platform, matar = process.kill, ejecutar = spawnSync } = {},
) {
  if (plataforma === 'win32') {
    const resultado = ejecutar('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
    if (resultado.status !== 0 || resultado.error) return false;
    return (resultado.stdout ?? '').includes(String(pid));
  }
  try {
    matar(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

/**
 * Un servicio registrado (`{ pid, puerto }`) cuenta como vivo si su pid existe y,
 * cuando tiene puerto propio (api, web; el worker no), ese puerto sigue
 * escuchando. Sin esto, un `pid` reciclado por el sistema operativo para otro
 * programa cualquiera se confundiría con «sigue arrancado».
 */
export async function servicioVivo(
  { pid, puerto },
  {
    plataforma = process.platform,
    ejecutar = spawnSync,
    matar = process.kill,
    comprobarPuerto = puertoOcupado,
  } = {},
) {
  if (!procesoVivo(pid, { plataforma, matar, ejecutar })) return false;
  if (puerto === undefined) return true;
  return comprobarPuerto(puerto);
}

/** `{cola, tenantId}` de la línea `SEMILLA_SALA` que escribe `demo-sala.ts --servir`, o undefined si no está. */
export function extraerSemillaSala(texto) {
  const cola = texto.match(/SEMILLA_SALA\b.*\bcola=(\S+)/)?.[1];
  const tenantId = texto.match(/SEMILLA_SALA\b.*\btenant=(\S+)/)?.[1];
  return cola && tenantId ? { cola, tenantId } : undefined;
}

/**
 * Pids de `netstat -ano` que escuchan (`LISTENING`) en ese puerto TCP. Pura sobre
 * el texto ya leído, para probar el parseo sin lanzar `netstat` de verdad.
 */
export function pidsDeNetstat(texto, puerto) {
  const objetivo = `:${puerto}`;
  const pids = new Set();
  for (const linea of texto.split(/\r?\n/)) {
    const columnas = linea.trim().split(/\s+/);
    if (columnas.length < 4) continue;
    const [protocolo, local, , estado, pid] = columnas;
    if (!/^TCPv?4?$/i.test(protocolo)) continue;
    if (estado !== 'LISTENING') continue;
    if (!local.endsWith(objetivo)) continue;
    const numero = Number(pid);
    if (Number.isInteger(numero)) pids.add(numero);
  }
  return [...pids];
}

/**
 * Pids que escuchan un puerto TCP local, con la herramienta de cada plataforma
 * (`netstat` en Windows, `lsof` en POSIX). Devuelve `[]` si la herramienta no
 * está disponible o no encuentra a nadie: quien llama no puede distinguir los dos
 * casos, así que trata la ausencia de la herramienta como «no se puede rematar»,
 * nunca como «ya está libre».
 */
export function pidsEnPuerto(puerto, { plataforma = process.platform, ejecutar = spawnSync } = {}) {
  if (plataforma === 'win32') {
    const resultado = ejecutar('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8' });
    if (resultado.status !== 0 || resultado.error) return [];
    return pidsDeNetstat(resultado.stdout ?? '', puerto);
  }
  const resultado = ejecutar('lsof', ['-ti', `tcp:${puerto}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (resultado.status !== 0 || resultado.error) return [];
  return (resultado.stdout ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map(Number)
    .filter((pid) => Number.isInteger(pid));
}

/** Mata un pid concreto (no su árbol: ya se intentó y no bastó). */
export function matarPid(
  pid,
  { plataforma = process.platform, ejecutar = spawnSync, matar = process.kill } = {},
) {
  if (plataforma === 'win32') {
    const resultado = ejecutar('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf8' });
    return resultado.status === 0;
  }
  try {
    matar(pid, 'SIGKILL');
    return true;
  } catch (error) {
    return error.code === 'ESRCH';
  }
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

/**
 * Para el árbol de un proceso registrado y, si tenía puerto propio, comprueba que
 * de verdad ha dejado de escuchar antes de darlo por parado. Segundo seguimiento
 * del Probador: en Windows, `taskkill /PID <pid> /T /F` en la raíz devuelve éxito
 * y aun así quedan vivos `cmd.exe /c tsx watch`, `next dev` o `demo-sala` — el
 * relanzamiento interno de pnpm por la versión del `packageManager` rompe la
 * cadena de procesos por el medio y `/T` no llega a esos nietos. Si el puerto
 * sigue ocupado, remata en concreto a quien lo escucha; si no se puede identificar
 * (herramienta ausente o puerto que sigue ocupado sin que nadie aparezca), lo dice
 * y no lo da por parado — nunca se borra `procesos.json` sobre una mentira.
 */
export async function pararServicio(
  { pid, puerto },
  {
    plataforma = process.platform,
    matar = process.kill,
    ejecutar = spawnSync,
    comprobarPuerto = puertoOcupado,
  } = {},
) {
  const arbol = pararArbolDeProcesos(pid, { plataforma, matar, ejecutar });
  if (!arbol.parado || puerto === undefined) return arbol;
  if (!(await comprobarPuerto(puerto))) return arbol;
  const pids = pidsEnPuerto(puerto, { plataforma, ejecutar });
  if (pids.length === 0) {
    return {
      parado: false,
      motivo: `el puerto ${puerto} sigue escuchando y no se ha podido identificar (ni rematar) quién lo tiene abierto.`,
    };
  }
  const rematados = pids.map((otroPid) => matarPid(otroPid, { plataforma, ejecutar, matar }));
  if (!rematados.every(Boolean)) {
    return {
      parado: false,
      motivo: `el puerto ${puerto} seguía abierto por el pid ${pids.join(', ')} y no se ha podido rematar del todo.`,
    };
  }
  return { parado: true };
}

/** Para cada proceso registrado su árbol entero. Si alguno no para, lo dice y no borra `procesos.json`. */
export async function pararProcesosRegistrados({ plataforma = process.platform } = {}) {
  const procesos = leerProcesos();
  let todosParados = true;
  for (const { nombre, pid, puerto } of procesos) {
    const resultado = await pararServicio({ pid, puerto }, { plataforma });
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
