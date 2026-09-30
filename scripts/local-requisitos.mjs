// Comprueba los requisitos de la máquina antes de arrancar: Docker, Node, pnpm,
// puertos libres, memoria y disco. Nunca modifica nada; solo informa.
import { spawnSync } from 'node:child_process';
import { freemem, totalmem } from 'node:os';
import { readFileSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

import { comandoPnpm, estadoServicios, puertoOcupado, raiz, valorEntorno } from './local-comun.mjs';

const NODE_MAYOR_MINIMO = 22;
const NODE_MAYOR_MAXIMO = 23; // exclusivo, como en package.json#engines
const PNPM_MAYOR_MINIMO = 10;
const MEMORIA_MINIMA_GB = 4;
const MEMORIA_RECOMENDADA_GB = 8;
const DISCO_MINIMO_GB = 3;
const DISCO_RECOMENDADO_GB = 10;
const GB = 1024 ** 3;

// Puertos que ocupa el Compose de desarrollo más api y web. El resto de servicios
// del Compose (silo-init, langfuse-worker, clickhouse, redis) no publican puerto.
const VARIABLE_POR_PUERTO = {
  POSTGRES_PORT: '5432',
  TEMPORAL_PORT: '7233',
  TEMPORAL_UI_PORT: '8080',
  CENTRIFUGO_PORT: '8000',
  S3_PORT: '9000',
  S3_CONSOLE_PORT: '9001',
  LANGFUSE_PORT: '3001',
  MAILPIT_SMTP_PORT: '1025',
  MAILPIT_UI_PORT: '8025',
};

function comandoDisponible(mandato, argumentos) {
  const resultado = spawnSync(mandato, argumentos, { encoding: 'utf8' });
  return { ok: resultado.status === 0 && !resultado.error, salida: resultado.stdout?.trim() };
}

/** `pnpm --version`, resuelto igual que lo lanza `lanzarProceso` (fallo 2). */
function pnpmDisponible({ plataforma = process.platform } = {}) {
  const { mandato, argumentos, opciones } = comandoPnpm(['--version'], { plataforma });
  const resultado = spawnSync(mandato, argumentos, { encoding: 'utf8', ...opciones });
  return { ok: resultado.status === 0 && !resultado.error, salida: resultado.stdout?.trim() };
}

/**
 * Ruta del `pnpm` que de verdad se lanza (`where`/`which`), o undefined si no
 * se puede resolver. Solo para informar en éxito (criterio menor del
 * seguimiento tras el #50: en éxito, la comprobación no decía qué pnpm había
 * encontrado, y en una máquina con más de uno instalado eso importa).
 */
function pnpmRuta({ plataforma = process.platform } = {}) {
  const mandato = plataforma === 'win32' ? 'where' : 'which';
  const resultado = spawnSync(mandato, ['pnpm'], { encoding: 'utf8' });
  if (resultado.status !== 0 || resultado.error) return undefined;
  return resultado.stdout?.trim().split(/\r?\n/)[0];
}

/** El `packageManager` de la raíz (`pnpm@10.33.0`), o undefined si no se puede leer. */
function packageManagerDeclarado() {
  try {
    const paquete = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));
    const declarado = typeof paquete.packageManager === 'string' ? paquete.packageManager : '';
    return declarado.startsWith('pnpm@') ? declarado.slice('pnpm@'.length) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * true si algún contenedor de nuestro propio Compose (fallo 3: `estadoServicios`
 * solo puede listar contenedores de este proyecto, Docker los distingue por
 * etiqueta de proyecto y no por puerto) ya publica ese puerto — un arranque
 * anterior o a medio parar, no un conflicto con otro programa.
 */
export function puertoDeNuestroCompose(puerto, servicios) {
  const texto = String(puerto);
  return servicios.some((servicio) => {
    const publicadores = Array.isArray(servicio.Publishers) ? servicio.Publishers : [];
    if (publicadores.some((p) => String(p.PublishedPort ?? '') === texto)) return true;
    return String(servicio.Ports ?? '').includes(`:${texto}->`);
  });
}

/**
 * `{ error?, aviso? }` para una versión de pnpm ya resuelta (fallo 1: pnpm 10 o
 * superior; avisa si difiere del `packageManager` declarado, sin abortar por
 * eso — decisión 4 de la especificación). Pura, para probarla sin lanzar pnpm.
 */
export function evaluarVersionPnpm(version, declarado) {
  const mayor = Number(version.split('.')[0]);
  if (!Number.isInteger(mayor) || mayor < PNPM_MAYOR_MINIMO) {
    return {
      error: `pnpm ${version || '(versión desconocida)'} no vale: hace falta pnpm ${PNPM_MAYOR_MINIMO} o superior.`,
    };
  }
  if (declarado !== undefined && declarado !== version) {
    return {
      aviso: `pnpm ${version} difiere del \`packageManager\` de package.json (pnpm@${declarado}); puede haber dos pnpm instalados.`,
    };
  }
  return {};
}

/**
 * Devuelve `{ errores, avisos }`. Con `errores` no vacío, `local:arrancar` para: la
 * máquina no puede sostener el resto de los pasos. Los `avisos` no paran nada.
 */
export async function comprobarRequisitos(env, { puertoApi = '3002', puertoWeb = '3000' } = {}) {
  const errores = [];
  const avisos = [];
  let pnpmInfo;

  const docker = comandoDisponible('docker', ['--version']);
  if (!docker.ok) {
    errores.push(
      'Docker no está instalado o no está en el PATH. Instala Docker Desktop (macOS) o Docker Engine (Linux).',
    );
  } else {
    const compose = comandoDisponible('docker', ['compose', 'version']);
    if (!compose.ok) {
      errores.push(
        'Docker Compose v2 no está disponible (`docker compose version` falla). Actualiza Docker.',
      );
    }
    const demonio = comandoDisponible('docker', ['info']);
    if (!demonio.ok) {
      errores.push(
        'El demonio de Docker no responde. Arranca Docker Desktop (o el servicio `docker` en Linux) y repite.',
      );
    }
  }

  const nodeMayor = Number(process.versions.node.split('.')[0]);
  if (nodeMayor < NODE_MAYOR_MINIMO || nodeMayor >= NODE_MAYOR_MAXIMO) {
    errores.push(
      `Node ${process.version} no vale: hace falta Node ${NODE_MAYOR_MINIMO}.x (ver .node-version). Con nvm: \`nvm use\`.`,
    );
  }

  const pnpm = pnpmDisponible();
  if (!pnpm.ok) {
    errores.push('pnpm no está en el PATH (o no se pudo lanzar). Con Corepack: `corepack enable`.');
  } else {
    const { error, aviso } = evaluarVersionPnpm(pnpm.salida, packageManagerDeclarado());
    if (error) errores.push(error);
    if (aviso) avisos.push(aviso);
    if (!error) pnpmInfo = { version: pnpm.salida, ruta: pnpmRuta() };
  }

  const servicios = estadoServicios();
  const ocupados = [];
  for (const [variable, porDefecto] of Object.entries(VARIABLE_POR_PUERTO)) {
    const puerto = valorEntorno(env, variable, porDefecto);
    if (puertoDeNuestroCompose(puerto, servicios)) continue;
    if (await puertoOcupado(puerto)) ocupados.push(`${puerto} (${variable})`);
  }
  const puertoApiReal = valorEntorno(env, 'AIW_API_PUERTO', puertoApi);
  if (await puertoOcupado(puertoApiReal)) ocupados.push(`${puertoApiReal} (AIW_API_PUERTO)`);
  const puertoWebReal = valorEntorno(env, 'AIW_WEB_PUERTO', puertoWeb);
  if (await puertoOcupado(puertoWebReal)) ocupados.push(`${puertoWebReal} (AIW_WEB_PUERTO)`);
  if (ocupados.length > 0) {
    errores.push(
      `Puertos ocupados: ${ocupados.join(', ')}. Si es un arranque anterior, ejecuta \`pnpm local:parar\` primero.`,
    );
  }

  const memoriaGb = totalmem() / GB;
  if (memoriaGb < MEMORIA_MINIMA_GB) {
    errores.push(
      `Memoria total ${memoriaGb.toFixed(1)} GB: hacen falta al menos ${MEMORIA_MINIMA_GB} GB.`,
    );
  } else if (memoriaGb < MEMORIA_RECOMENDADA_GB) {
    avisos.push(
      `Memoria total ${memoriaGb.toFixed(1)} GB: con menos de ${MEMORIA_RECOMENDADA_GB} GB el arranque puede ir lento.`,
    );
  }
  // Umbral de 3 GB fijado con datos reales: en una máquina con 29,7 GB totales pero
  // otros tres proyectos ya corriendo en Docker, el arranque terminó con 2,7 GB
  // libres y funcionó, pero justo. Con menos, el aviso llega antes de que algo falle.
  if (freemem() / GB < 3) {
    avisos.push(
      `Memoria libre ${(freemem() / GB).toFixed(1)} GB: si tienes otros proyectos corriendo en Docker, para sus contenedores o cierra alguna aplicación antes de arrancar.`,
    );
  }

  try {
    const disco = statfsSync(raiz);
    const libreGb = (disco.bavail * disco.bsize) / GB;
    if (libreGb < DISCO_MINIMO_GB) {
      errores.push(
        `Disco libre ${libreGb.toFixed(1)} GB en ${raiz}: hacen falta al menos ${DISCO_MINIMO_GB} GB.`,
      );
    } else if (libreGb < DISCO_RECOMENDADO_GB) {
      avisos.push(
        `Disco libre ${libreGb.toFixed(1)} GB: con menos de ${DISCO_RECOMENDADO_GB} GB los volúmenes pueden llenarlo.`,
      );
    }
  } catch {
    avisos.push(
      'No se ha podido comprobar el disco libre en esta plataforma; sigue bajo tu responsabilidad.',
    );
  }

  return { errores, avisos, pnpmInfo };
}
