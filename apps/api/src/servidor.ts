/**
 * Servidor HTTP de la API.
 *
 * `node:http` y no un framework: la única cosa que sirve hoy son tres rutas de
 * lectura del contador, y elegir el framework es decisión de la rebanada que monte
 * la API de verdad (el ADR-002 fija el stack, no la capa HTTP). Añadir una
 * dependencia para tres `GET` sería decidir por ella.
 *
 * El servidor no sabe nada del contador más allá de una línea: registra su manejador
 * y, si ninguno reconoce la ruta, responde 404.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { crearConexion, type Conexion } from '@aiw/db';

import {
  atenderContador,
  configuracionDesdeEntorno,
  lectorConBaseDeDatos,
  type RespuestaContador,
} from './rutas/contador.js';

export const PUERTO_POR_DEFECTO = 3002;

export interface OpcionesServidor {
  entorno?: Record<string, string | undefined> | undefined;
  /** Conexión ya abierta. Si falta, se abre con `DATABASE_URL` y el rol de aplicación. */
  conexion?: Conexion | undefined;
}

export interface ApiEnMarcha {
  servidor: Server;
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

  // Contador de tareas v0: una línea, y el módulo decide si la ruta existe.
  if (conexion) {
    const configuracion = configuracionDesdeEntorno(entorno);
    const lector = lectorConBaseDeDatos(conexion.cliente);
    manejadores.push((peticion) =>
      atenderContador(
        { metodo: peticion.method, url: peticion.url, cabeceras: peticion.headers },
        configuracion,
        lector,
      ),
    );
  }

  const servidor = createServer((peticion, respuesta) => {
    void (async () => {
      try {
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
    cerrarConexion: async () => {
      if (opciones.conexion === undefined && conexion) await conexion.cerrar();
    },
  };
}

/** Arranca el servidor. Devuelve el puerto real, que en pruebas es uno libre. */
export async function arrancarApi(opciones: OpcionesServidor = {}): Promise<ApiEnMarcha> {
  const entorno = opciones.entorno ?? process.env;
  const pedido = Number(entorno['AIW_API_PUERTO'] ?? PUERTO_POR_DEFECTO);
  const puerto = Number.isFinite(pedido) && pedido >= 0 ? pedido : PUERTO_POR_DEFECTO;
  const { servidor, cerrarConexion } = crearApi(opciones);

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
