/**
 * Servidor HTTP de la API.
 *
 * `node:http` y no un framework: elegirlo es decisión de la rebanada que monte la
 * API de verdad (el ADR-002 fija el stack, no la capa HTTP). Hoy sirve las rutas
 * del contador, las de la sala y el acceso de Better Auth, que habla `Request` y
 * `Response` y se traduce en `rutas/acceso.ts`.
 *
 * El servidor no sabe nada del contador más allá de una línea: registra su manejador
 * y, si ninguno reconoce la ruta, responde 404.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { ROL_IDENTIDAD, crearConexion, type Conexion } from '@aiw/db';
import type { PuertoDeCorreo } from '@aiw/domain';

import {
  SIN_SESION,
  crearAcceso,
  puertoIdentidad,
  type Acceso,
  type ResolutorDeSesion,
} from './identidad/acceso.js';
import { anotadorConBaseDeDatos } from './identidad/auditoria.js';
import { configuracionAccesoDesdeEntorno } from './identidad/configuracion.js';
import { crearCorreo } from './identidad/correo.js';
import {
  CuerpoDemasiadoGrande,
  aPeticionWeb,
  escribirRespuestaWeb,
  esRutaDeAcceso,
} from './rutas/acceso.js';

import {
  atenderContador,
  configuracionDesdeEntorno,
  lectorConBaseDeDatos,
  type RespuestaContador,
} from './rutas/contador.js';
import {
  atenderInicio,
  configuracionInicioDesdeEntorno,
  puertoInicio,
  type PuertoInicio,
} from './rutas/inicio.js';
import { atenderPerfil, puertoPerfilConBaseDeDatos } from './rutas/perfil.js';
import {
  atenderSala,
  configuracionSalaDesdeEntorno,
  puertoSala,
  type ClienteDeFlujos,
  type PuertoSala,
} from './rutas/sala.js';

export const PUERTO_POR_DEFECTO = 3002;

export interface OpcionesServidor {
  entorno?: Record<string, string | undefined> | undefined;
  /** Conexión ya abierta. Si falta, se abre con `DATABASE_URL` y el rol de aplicación. */
  conexion?: Conexion | undefined;
  /** Puerto de la sala ya construido. Solo para pruebas. */
  puertoSala?: PuertoSala | undefined;
  /** Puerto del inicio ya construido. Solo para pruebas. */
  puertoInicio?: PuertoInicio | undefined;
  /** Correo del acceso. Solo para pruebas: si falta, sale de `AIW_CORREO_PROVEEDOR`. */
  correoAcceso?: PuertoDeCorreo | undefined;
}

/** Tope del cuerpo de una petición: un mensaje de sala cabe de sobra. */
const TOPE_CUERPO = 16 * 1024;

/** Lee el cuerpo JSON. Uno que no es JSON o que pasa del tope se trata como vacío. */
async function leerJson(peticion: IncomingMessage): Promise<unknown> {
  const trozos: Buffer[] = [];
  let tamano = 0;
  for await (const trozo of peticion) {
    const buffer = trozo as Buffer;
    tamano += buffer.length;
    if (tamano > TOPE_CUERPO) return undefined;
    trozos.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(trozos).toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Abre el cliente de Temporal. Solo se importa si se usa, y lo comparten la sala y
 * el inicio: las dos arrancan y señalan flujos por nombre e id, así que una sola
 * conexión perezosa basta para las dos (`servidor.ts` la abre con la primera
 * escritura de cualquiera de las dos, no al arrancar la API).
 */
async function abrirFlujos(configuracion: { temporal: { direccion: string; espacio: string } }) {
  const { Client, Connection } = await import('@temporalio/client');
  const conexion = await Connection.connect({ address: configuracion.temporal.direccion });
  const cliente = new Client({ connection: conexion, namespace: configuracion.temporal.espacio });
  return {
    async arrancar(nombre: string, opciones: { cola: string; id: string; args: unknown[] }) {
      await cliente.workflow.start(nombre, {
        taskQueue: opciones.cola,
        workflowId: opciones.id,
        args: opciones.args,
      });
    },
    async senalar(id: string, senal: string, carga: unknown) {
      await cliente.workflow.getHandle(id).signal(senal, carga);
    },
    cerrar: () => conexion.close(),
  };
}

export interface ApiEnMarcha {
  servidor: Server;
  acceso: Acceso | undefined;
  puerto: number;
  cerrar: () => Promise<void>;
}

type Manejador = (
  peticion: IncomingMessage,
) => Promise<RespuestaContador | undefined> | RespuestaContador | undefined;

function responder(respuesta: ServerResponse, resultado: RespuestaContador): void {
  respuesta.writeHead(resultado.estado, resultado.cabeceras);
  respuesta.end(JSON.stringify(resultado.cuerpo));
}

export function crearApi(opciones: OpcionesServidor = {}): {
  servidor: Server;
  acceso: Acceso | undefined;
  cerrarConexion: () => Promise<void>;
} {
  const entorno = opciones.entorno ?? process.env;
  const url = entorno['DATABASE_URL'];
  const conexion =
    opciones.conexion ??
    (url === undefined
      ? undefined
      : crearConexion({ url, rolAplicacion: entorno['AIW_ROL_APLICACION'] ?? 'aiw_app' }));

  const manejadores: Manejador[] = [];

  // Acceso al panel: Better Auth con su propia conexión y el rol de identidad, que
  // es el único que lee usuarios y sesiones. Sin bandera, nadie tiene sesión y las
  // rutas de datos responden 401: el tenant ya no llega por cabecera.
  const configuracionAcceso = configuracionAccesoDesdeEntorno(entorno);
  let conexionIdentidad: Conexion | undefined;
  let acceso: Acceso | undefined;
  if (configuracionAcceso && conexion && url) {
    conexionIdentidad = crearConexion({ url, rolAplicacion: ROL_IDENTIDAD, maxConexiones: 5 });
    acceso = crearAcceso({
      configuracion: configuracionAcceso,
      dbIdentidad: conexionIdentidad.crearDb(),
      puerto: puertoIdentidad(conexionIdentidad.cliente, conexion.cliente),
      anotador: anotadorConBaseDeDatos(conexion.cliente),
      correo: opciones.correoAcceso ?? crearCorreo(configuracionAcceso.correo),
    });
  }
  const resolverSesion: ResolutorDeSesion = acceso?.resolverSesion ?? SIN_SESION;

  // Contador de tareas v0: una línea, y el módulo decide si la ruta existe.
  if (conexion) {
    const configuracion = configuracionDesdeEntorno(entorno);
    const lector = lectorConBaseDeDatos(conexion.cliente);
    manejadores.push((peticion) =>
      atenderContador(
        { metodo: peticion.method, url: peticion.url, cabeceras: peticion.headers },
        configuracion,
        lector,
        resolverSesion,
      ),
    );
  }

  // Perfil: el ajuste de presencia (ADR-026). Solo exige sesión, como el resto de
  // rutas de datos desde «Acceso al panel»; sin conexión a la base no existe.
  if (conexion) {
    const puertoPerfil = puertoPerfilConBaseDeDatos(conexion.cliente);
    manejadores.push(async (peticion) =>
      atenderPerfil(
        {
          metodo: peticion.method,
          url: peticion.url,
          cabeceras: peticion.headers,
          cuerpo: peticion.method === 'PATCH' ? await leerJson(peticion) : undefined,
        },
        puertoPerfil,
        resolverSesion,
      ),
    );
  }

  // Cliente de Temporal compartido por la sala v0 y el inicio: la primera escritura
  // de cualquiera de las dos lo abre; ninguna lo abre al arrancar la API.
  let flujosAbiertos: Awaited<ReturnType<typeof abrirFlujos>> | undefined;
  function flujosCompartidos(configuracion: {
    temporal: { direccion: string; espacio: string };
  }): ClienteDeFlujos {
    return {
      async arrancar(nombre, opciones) {
        flujosAbiertos ??= await abrirFlujos(configuracion);
        await flujosAbiertos.arrancar(nombre, opciones);
      },
      async senalar(id, senal, carga) {
        flujosAbiertos ??= await abrirFlujos(configuracion);
        await flujosAbiertos.senalar(id, senal, carga);
      },
    };
  }

  // Sala v0: otra línea, y el módulo decide si la ruta existe.
  const configuracionSala = configuracionSalaDesdeEntorno(entorno);
  if (conexion && configuracionSala) {
    const flujos = flujosCompartidos(configuracionSala);
    const puerto = opciones.puertoSala ?? puertoSala(conexion.cliente, flujos, configuracionSala);
    manejadores.push(async (peticion) =>
      atenderSala(
        {
          metodo: peticion.method,
          url: peticion.url,
          cabeceras: peticion.headers,
          cuerpo: peticion.method === 'POST' ? await leerJson(peticion) : undefined,
        },
        configuracionSala,
        puerto,
        resolverSesion,
      ),
    );
  }

  // Inicio: agentes en tiempo real, avisos a la derecha, encargar y decidir en
  // línea. Misma sesión que el resto del panel desde «Acceso al panel», así que
  // basta con la conexión: sin ella, ninguna de las dos rutas existe.
  const configuracionInicio = configuracionInicioDesdeEntorno(entorno);
  if (conexion && configuracionInicio) {
    const flujos = flujosCompartidos(configuracionInicio);
    const puerto =
      opciones.puertoInicio ?? puertoInicio(conexion.cliente, flujos, configuracionInicio);
    manejadores.push(async (peticion) =>
      atenderInicio(
        {
          metodo: peticion.method,
          url: peticion.url,
          cabeceras: peticion.headers,
          cuerpo: peticion.method === 'POST' ? await leerJson(peticion) : undefined,
        },
        configuracionInicio,
        puerto,
        resolverSesion,
      ),
    );
  }

  const servidor = createServer((peticion, respuesta) => {
    void (async () => {
      try {
        if (acceso && esRutaDeAcceso(peticion.url)) {
          await escribirRespuestaWeb(await acceso.manejar(await aPeticionWeb(peticion)), respuesta);
          return;
        }
        for (const manejador of manejadores) {
          const resultado = await manejador(peticion);
          if (resultado) {
            responder(respuesta, resultado);
            return;
          }
        }
        responder(respuesta, {
          estado: 404,
          cuerpo: { error: 'Esa ruta no existe.' },
          cabeceras: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      } catch (error) {
        if (error instanceof CuerpoDemasiadoGrande) {
          responder(respuesta, {
            estado: 413,
            cuerpo: { error: error.message },
            cabeceras: {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          });
          return;
        }
        // El detalle va al registro del proceso, no a quien pregunta: un mensaje de
        // la base puede decir más de la cuenta sobre el esquema.
        console.error('[api] la petición falló:', error instanceof Error ? error.message : error);
        responder(respuesta, {
          estado: 500,
          cuerpo: { error: 'La petición falló.' },
          cabeceras: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      }
    })();
  });

  return {
    servidor,
    acceso,
    cerrarConexion: async () => {
      await flujosAbiertos?.cerrar();
      await conexionIdentidad?.cerrar();
      if (opciones.conexion === undefined && conexion) await conexion.cerrar();
    },
  };
}

/** Arranca el servidor. Devuelve el puerto real, que en pruebas es uno libre. */
export async function arrancarApi(opciones: OpcionesServidor = {}): Promise<ApiEnMarcha> {
  const entorno = opciones.entorno ?? process.env;
  const pedido = Number(entorno['AIW_API_PUERTO'] ?? PUERTO_POR_DEFECTO);
  const puerto = Number.isFinite(pedido) && pedido >= 0 ? pedido : PUERTO_POR_DEFECTO;
  const { servidor, acceso, cerrarConexion } = crearApi(opciones);

  await new Promise<void>((resolver, rechazar) => {
    servidor.once('error', rechazar);
    servidor.listen(puerto, () => {
      servidor.off('error', rechazar);
      resolver();
    });
  });

  const direccion = servidor.address();
  return {
    servidor,
    acceso,
    puerto: typeof direccion === 'object' && direccion ? direccion.port : puerto,
    cerrar: async () => {
      await new Promise<void>((resolver) => {
        servidor.close(() => {
          resolver();
        });
      });
      await cerrarConexion();
    },
  };
}
