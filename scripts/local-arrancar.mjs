#!/usr/bin/env node
// `pnpm local:arrancar`: desde un clon limpio de main, un solo comando que deja el
// entorno local completo arriba, con datos de demo sintéticos.
//
// 1. Comprueba los requisitos de la máquina (Docker, Node, pnpm, puertos, memoria, disco).
// 2. Genera .env si no existe (secretos aleatorios locales, nunca en el repositorio).
// 3. Levanta el Compose de desarrollo y espera a que esté sano.
// 4. Aplica las migraciones.
// 5. Siembra Finanzas con Cobros y la sala general (`demo:sala --servir`), que además
//    deja un trabajador de Temporal escuchando: es la vez de "worker" y de "datos de
//    demo sintéticos" a la vez, reutilizando la demostración de «Sala v0».
// 6. Arranca `api` y `web` con las banderas de sala y de contador encendidas.
// 7. Comprueba salud y termina imprimiendo las URL que se pueden abrir.
//
// Uso: `pnpm local:arrancar` · `pnpm local:arrancar -- --no-interactivo` (para la CI).
import { spawnSync } from 'node:child_process';

import {
  asegurarEnv,
  completarEnv,
  composeArgs,
  esperarEnFichero,
  esperarPuerto,
  estadoServicios,
  lanzarProceso,
  leerEnv,
  migrarEnv,
  raiz,
  registrarProceso,
  tieneBandera,
  tokenAleatorio,
  urlBaseDeDatos,
} from './local-comun.mjs';
import { comprobarRequisitos } from './local-requisitos.mjs';

const argumentos = process.argv.slice(2);
const noInteractivo = tieneBandera(argumentos, 'no-interactivo');

function paso(texto) {
  console.log(`\n— ${texto}`);
}

function fallar(mensaje) {
  console.error(`\n${mensaje}`);
  console.error('Nada se ha dejado a medias que `pnpm local:parar` no pueda limpiar.');
  process.exit(1);
}

paso('Preparando .env');
if (asegurarEnv()) console.log('  creado .env con secretos aleatorios locales; no se versiona.');
else console.log('  reutilizando .env existente.');
for (const anadida of migrarEnv()) console.log(`  añadida ${anadida} desde el nombre anterior.`);
for (const anadida of completarEnv()) console.log(`  añadida ${anadida} (nueva en .env.example).`);

const env = leerEnv();

paso('Comprobando requisitos de la máquina');
const { errores, avisos } = await comprobarRequisitos(env);
for (const aviso of avisos) console.warn(`  aviso: ${aviso}`);
if (errores.length > 0) {
  fallar(['No se cumplen los requisitos:', ...errores.map((e) => `  - ${e}`)].join('\n'));
}
console.log('  requisitos en orden.');

paso('Levantando el Compose de desarrollo (puede tardar unos minutos la primera vez)');
const compose = spawnSync('docker', [...composeArgs, 'up', '-d', '--wait'], {
  cwd: raiz,
  stdio: 'inherit',
});
if (compose.status !== 0) {
  fallar('El Compose no ha arrancado. Revisa el mensaje de arriba y `docker compose ... logs`.');
}
console.log('  servicios sanos.');

const urlBase = urlBaseDeDatos(env);

paso('Aplicando migraciones');
const migracion = spawnSync('pnpm', ['--filter', '@aiw/db', 'db:migrar'], {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: urlBase },
});
if (migracion.status !== 0) fallar('La migración ha fallado.');

paso('Sembrando datos de demo (Finanzas, Cobros y la sala general) y arrancando el worker');
const demoConector = env.DEMO_CONECTOR_SECRETO;
if (!demoConector) fallar('Falta DEMO_CONECTOR_SECRETO en .env; borra .env y vuelve a arrancar.');
const { proceso: procesoSala, rutaRegistro: registroSala } = lanzarProceso(
  'worker-sala',
  'pnpm',
  ['--filter', '@aiw/worker', 'demo:sala', '--servir'],
  {
    env: {
      ...env,
      DATABASE_URL: urlBase,
      AIW_PRUEBA_STACK: '1',
      DEMO_CONECTOR_SECRETO: demoConector,
    },
  },
);
let semilla;
try {
  semilla = await esperarEnFichero(
    registroSala,
    procesoSala,
    (texto) => {
      const cola = texto.match(/AIW_TEMPORAL_COLA=(\S+)/)?.[1];
      const tenantId = texto.match(/AIW_SALA_TENANT=(\S+)/)?.[1];
      const personaId = texto.match(/AIW_SALA_PERSONA=(\S+)/)?.[1];
      return cola && tenantId && personaId ? { cola, tenantId, personaId } : undefined;
    },
    { timeoutMs: 90_000 },
  );
} catch (error) {
  fallar(`La demo de sala no ha arrancado: ${error.message}\nRegistro: ${registroSala}`);
}
registrarProceso('worker-sala', procesoSala.pid, registroSala);
console.log(`  sembrado: organización ${semilla.tenantId}, cola ${semilla.cola}.`);

paso('Arrancando api y web');
const salaToken = env.AIW_SALA_TOKEN || tokenAleatorio();
const contadorToken = env.AIW_CONTADOR_TOKEN;
if (!contadorToken) fallar('Falta AIW_CONTADOR_TOKEN en .env; borra .env y vuelve a arrancar.');
const puertoApi = env.AIW_API_PUERTO || '3002';
const puertoWeb = '3000';

const { proceso: procesoApi, rutaRegistro: registroApi } = lanzarProceso(
  'api',
  'pnpm',
  ['--filter', '@aiw/api', 'dev'],
  {
    env: {
      ...env,
      DATABASE_URL: urlBase,
      AIW_SALA_V0: '1',
      AIW_SALA_TOKEN: salaToken,
      AIW_TEMPORAL_COLA: semilla.cola,
      AIW_CONTADOR_V0: '1',
      AIW_CONTADOR_TOKEN: contadorToken,
      AIW_API_PUERTO: puertoApi,
    },
  },
);
registrarProceso('api', procesoApi.pid, registroApi);

const { proceso: procesoWeb, rutaRegistro: registroWeb } = lanzarProceso(
  'web',
  'pnpm',
  ['--filter', '@aiw/web', 'dev'],
  {
    env: {
      ...env,
      AIW_SALA_V0: '1',
      AIW_API_URL: `http://127.0.0.1:${puertoApi}`,
      AIW_SALA_TOKEN: salaToken,
      AIW_SALA_TENANT: semilla.tenantId,
      AIW_SALA_PERSONA: semilla.personaId,
      AIW_PANEL_CONTADOR: '1',
      AIW_PANEL_TENANT: semilla.tenantId,
      AIW_CONTADOR_TOKEN: contadorToken,
    },
  },
);
registrarProceso('web', procesoWeb.pid, registroWeb);

paso('Comprobando salud');
try {
  await esperarPuerto(puertoApi, { timeoutMs: 60_000 });
  console.log(`  api escuchando en ${puertoApi}.`);
  await esperarPuerto(puertoWeb, { timeoutMs: 90_000 });
  console.log(`  web escuchando en ${puertoWeb}.`);
} catch (error) {
  fallar(`${error.message}\nRegistros: ${registroApi}\n${registroWeb}`);
}
const noSanos = estadoServicios().filter(
  (s) => s.Health && s.Health !== 'healthy' && s.Health !== '',
);
if (noSanos.length > 0) {
  console.warn(`  aviso: servicios sin salud verde: ${noSanos.map((s) => s.Name).join(', ')}.`);
}

console.log(`
Entorno local arrancado. Se puede abrir:
  Panel de muestras   http://localhost:${puertoWeb}/panel/muestras
  Sala                http://localhost:${puertoWeb}/panel/sala
  Contador de tareas  http://localhost:${puertoWeb}/panel/contador
  Prototipo           http://localhost:${puertoWeb}/prototipo
  Temporal UI         http://localhost:${env.TEMPORAL_UI_PORT || '8080'}
  Langfuse            http://localhost:${env.LANGFUSE_PORT || '3001'}
  Mailpit             http://localhost:${env.MAILPIT_UI_PORT || '8025'}

Organización de demo: ${semilla.tenantId}
Registros en .aiw-local/registros/. Para parar: pnpm local:parar
`);
if (noInteractivo)
  console.log('(modo no interactivo: el proceso termina aquí, todo sigue en marcha)');
