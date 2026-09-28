// Comprueba los requisitos de la máquina antes de arrancar: Docker, Node, pnpm,
// puertos libres, memoria y disco. Nunca modifica nada; solo informa.
import { spawnSync } from 'node:child_process';
import { freemem, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';

import { puertoOcupado, raiz } from './local-comun.mjs';

const NODE_MAYOR_MINIMO = 22;
const NODE_MAYOR_MAXIMO = 23; // exclusivo, como en package.json#engines
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
const PUERTO_WEB = '3000';

function comandoDisponible(mandato, argumentos) {
  const resultado = spawnSync(mandato, argumentos, { encoding: 'utf8' });
  return { ok: resultado.status === 0 && !resultado.error, salida: resultado.stdout?.trim() };
}

/**
 * Devuelve `{ errores, avisos }`. Con `errores` no vacío, `local:arrancar` para: la
 * máquina no puede sostener el resto de los pasos. Los `avisos` no paran nada.
 */
export async function comprobarRequisitos(env, { puertoApi = '3002' } = {}) {
  const errores = [];
  const avisos = [];

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

  const pnpm = comandoDisponible('pnpm', ['--version']);
  if (!pnpm.ok) {
    errores.push('pnpm no está en el PATH. Con Corepack: `corepack enable`.');
  }

  const puertos = { ...VARIABLE_POR_PUERTO };
  const ocupados = [];
  for (const [variable, porDefecto] of Object.entries(puertos)) {
    const puerto = env[variable] || porDefecto;
    if (await puertoOcupado(puerto)) ocupados.push(`${puerto} (${variable})`);
  }
  if (await puertoOcupado(env.AIW_API_PUERTO || puertoApi)) {
    ocupados.push(`${env.AIW_API_PUERTO || puertoApi} (AIW_API_PUERTO)`);
  }
  if (await puertoOcupado(PUERTO_WEB)) ocupados.push(`${PUERTO_WEB} (web)`);
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
  if (freemem() / GB < 1) {
    avisos.push(
      `Memoria libre ${(freemem() / GB).toFixed(1)} GB: cierra alguna aplicación antes de arrancar.`,
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

  return { errores, avisos };
}
