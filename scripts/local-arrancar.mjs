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
// 6. Invita a una persona propietaria en esa organización («Acceso al panel»), con
//    el aviso por Mailpit.
// 7. Arranca `api` y `web` con las banderas de sala, de contador y de acceso
//    encendidas: la organización y la persona salen de la sesión, no del entorno.
// 8. Comprueba salud y termina imprimiendo las URL y cómo entrar.
//
// Uso: `pnpm local:arrancar` · `pnpm local:arrancar -- --no-interactivo` (para la CI).
import { spawnSync } from 'node:child_process';

import {
  asegurarEnv,
  comandoPnpm,
  completarEnv,
  composeArgs,
  entornoDeProceso,
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
  valorEntorno,
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
const { errores, avisos, pnpmInfo } = await comprobarRequisitos(env);
for (const aviso of avisos) console.warn(`  aviso: ${aviso}`);
if (errores.length > 0) {
  fallar(['No se cumplen los requisitos:', ...errores.map((e) => `  - ${e}`)].join('\n'));
}
console.log('  requisitos en orden.');
if (pnpmInfo) {
  console.log(`  pnpm ${pnpmInfo.version}${pnpmInfo.ruta ? ` (${pnpmInfo.ruta})` : ''}.`);
}

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
const mandatoMigracion = comandoPnpm(['--filter', '@aiw/db', 'db:migrar']);
const migracion = spawnSync(mandatoMigracion.mandato, mandatoMigracion.argumentos, {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: urlBase },
  ...mandatoMigracion.opciones,
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
    env: entornoDeProceso(env, {
      DATABASE_URL: urlBase,
      AIW_PRUEBA_STACK: '1',
      // Proveedor de modelos de la demo: `prueba` (determinista, sin claves ni coste) salvo
      // que .env o el entorno digan otra cosa, p. ej. AIW_PROVEEDOR_MODELOS=bedrock-ue.
      AIW_PROVEEDOR_MODELOS: valorEntorno(env, 'AIW_PROVEEDOR_MODELOS', 'prueba'),
      DEMO_CONECTOR_SECRETO: demoConector,
    }),
  },
);
// Registrado en cuanto se lanza, no cuando termina de arrancar: si el arranque
// falla o se agota el plazo de abajo, `pnpm local:parar` tiene que poder
// encontrar y parar este proceso igual (antes no quedaba en `procesos.json` y
// un arranque fallido dejaba un huérfano que nada limpiaba).
registrarProceso('worker-sala', procesoSala.pid, registroSala);
let semilla;
try {
  semilla = await esperarEnFichero(
    registroSala,
    procesoSala,
    (texto) => {
      // Contrato estable con `demo-sala.ts --servir`: una sola línea, sin personaId
      // (la persona la decide la sesión de «Acceso al panel», no un valor fijo).
      const cola = texto.match(/SEMILLA_SALA\b.*\bcola=(\S+)/)?.[1];
      const tenantId = texto.match(/SEMILLA_SALA\b.*\btenant=(\S+)/)?.[1];
      return cola && tenantId ? { cola, tenantId } : undefined;
    },
    { timeoutMs: 90_000 },
  );
} catch (error) {
  fallar(`La demo de sala no ha arrancado: ${error.message}\nRegistro: ${registroSala}`);
}
console.log(`  sembrado: organización ${semilla.tenantId}, cola ${semilla.cola}.`);

const salaToken = env.AIW_SALA_TOKEN || tokenAleatorio();
// Encendida por defecto en local (fallo 6); una exportación real en la terminal
// (p. ej. `AIW_SALA_V1=0 pnpm local:arrancar`) manda sobre este valor por defecto,
// igual que sobre cualquier otra variable de `.env` (`valorEntorno`).
const salaV1 = valorEntorno({}, 'AIW_SALA_V1', '1');
const contadorToken = env.AIW_CONTADOR_TOKEN;
if (!contadorToken) fallar('Falta AIW_CONTADOR_TOKEN en .env; borra .env y vuelve a arrancar.');
const accesoSecreto = env.AIW_ACCESO_SECRETO;
if (!accesoSecreto) fallar('Falta AIW_ACCESO_SECRETO en .env; borra .env y vuelve a arrancar.');
const puertoApi = valorEntorno(env, 'AIW_API_PUERTO', '3002');
const puertoWeb = valorEntorno(env, 'AIW_WEB_PUERTO', '3000');
// `localhost` y no `127.0.0.1`: es la URL que se imprime al final, y Better Auth
// compara el origen, pone la cookie y fija el dominio de la passkey con ella
// (WebAuthn solo admite http en localhost).
const urlPublicaWeb = `http://localhost:${puertoWeb}`;
const puertoMailpitWeb = valorEntorno(env, 'MAILPIT_UI_PORT', '8025');
// El correo del acceso va a Mailpit, que ya está en el Compose: con `memoria` el
// enlace mágico se quedaría dentro del proceso de la api y nadie podría entrar.
const correoPorMailpit = {
  AIW_CORREO_PROVEEDOR: 'smtp',
  AIW_CORREO_SMTP_HOST: '127.0.0.1',
  AIW_CORREO_SMTP_PUERTO: valorEntorno(env, 'MAILPIT_SMTP_PORT', '1025'),
  AIW_CORREO_SMTP_TLS: '0',
  AIW_CORREO_SMTP_USUARIO: '',
  AIW_CORREO_SMTP_CONTRASENA: '',
};

paso('Invitando a la persona propietaria de la demo (Acceso al panel)');
// Un correo por organización sembrada: el correo de un usuario es único en toda la
// plataforma, y cada arranque siembra una organización nueva sobre la misma base.
const correoDemo = `demo-${semilla.tenantId.slice(-12)}@aiworkforce.local`;
const mandatoInvitacion = comandoPnpm([
  '--filter',
  '@aiw/api',
  'invitar-propietario',
  '--tenant',
  semilla.tenantId,
  '--nombre',
  'Persona de demo',
  '--correo',
  correoDemo,
]);
const invitacion = spawnSync(mandatoInvitacion.mandato, mandatoInvitacion.argumentos, {
  cwd: raiz,
  stdio: 'inherit',
  env: entornoDeProceso(env, {
    ...correoPorMailpit,
    DATABASE_URL: urlBase,
    AIW_WEB_URL_PUBLICA: urlPublicaWeb,
  }),
  ...mandatoInvitacion.opciones,
});
if (invitacion.status !== 0) fallar('No se pudo invitar a la persona propietaria de la demo.');
console.log(`  invitada: ${correoDemo}.`);

paso('Arrancando api y web');
const { proceso: procesoApi, rutaRegistro: registroApi } = lanzarProceso(
  'api',
  'pnpm',
  ['--filter', '@aiw/api', 'dev'],
  {
    env: entornoDeProceso(env, {
      DATABASE_URL: urlBase,
      AIW_SALA_V0: '1',
      AIW_SALA_V1: salaV1,
      AIW_SALA_TOKEN: salaToken,
      AIW_TEMPORAL_COLA: semilla.cola,
      AIW_CONTADOR_V0: '1',
      AIW_CONTADOR_TOKEN: contadorToken,
      AIW_API_PUERTO: puertoApi,
      AIW_ACCESO_PANEL: '1',
      AIW_ACCESO_SECRETO: accesoSecreto,
      AIW_WEB_URL_PUBLICA: urlPublicaWeb,
      ...correoPorMailpit,
    }),
  },
);
registrarProceso('api', procesoApi.pid, registroApi);

const { proceso: procesoWeb, rutaRegistro: registroWeb } = lanzarProceso(
  'web',
  'pnpm',
  ['--filter', '@aiw/web', 'dev'],
  {
    env: entornoDeProceso(env, {
      PORT: puertoWeb,
      AIW_SALA_V0: '1',
      AIW_SALA_V1: salaV1,
      AIW_API_URL: `http://127.0.0.1:${puertoApi}`,
      AIW_SALA_TOKEN: salaToken,
      AIW_ACCESO_PANEL: '1',
      AIW_PANEL_CONTADOR: '1',
      AIW_CONTADOR_TOKEN: contadorToken,
    }),
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
  Temporal UI         http://localhost:${valorEntorno(env, 'TEMPORAL_UI_PORT', '8080')}
  Langfuse            http://localhost:${valorEntorno(env, 'LANGFUSE_PORT', '3001')}
  Mailpit             http://localhost:${puertoMailpitWeb}

Organización de demo: ${semilla.tenantId}
Para entrar al panel: abre ${urlPublicaWeb}/acceso, pide el enlace para ${correoDemo}
y ábrelo desde Mailpit (http://localhost:${puertoMailpitWeb}).
Registros en .aiw-local/registros/. Para parar: pnpm local:parar
`);
if (noInteractivo)
  console.log('(modo no interactivo: el proceso termina aquí, todo sigue en marcha)');
