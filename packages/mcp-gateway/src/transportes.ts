/**
 * Fábricas de transporte: por dónde se llega a un servidor MCP.
 *
 * Tres caminos y la misma regla en los tres: el secreto entra en la **conexión** y
 * no en los argumentos de ninguna herramienta.
 *
 * - **Proceso hijo por entrada estándar.** El gateway lanza el proceso del conector
 *   y le inyecta la credencial como variable de entorno. No va en la línea de
 *   mandatos, porque los argumentos de un proceso se ven en la lista de procesos de
 *   la máquina; y no va en el contexto del modelo, porque el modelo no participa en
 *   arrancar un proceso.
 * - **HTTP transmisible.** La credencial va en la cabecera `Authorization`, que es
 *   donde la espera cualquier servicio, y la cabecera la pone el gateway al abrir
 *   la conexión.
 * - **En memoria.** Para las pruebas y para el trabajador que monta el conector
 *   dentro de su proceso. La fábrica la construye quien tenga el servidor; el
 *   gateway solo necesita el transporte.
 *
 * Ninguna de estas funciones devuelve el secreto ni lo guarda. Lo reciben, lo meten
 * donde va y lo sueltan.
 */
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { conectarPorMcp } from './cliente-mcp.js';
import type { ConexionMcp } from './herramientas.js';
import type { Secreto } from './secretos.js';

export interface OpcionesProcesoHijo {
  /** Mandato a ejecutar, p. ej. `node` o `tsx`. */
  comando: string;
  argumentos?: readonly string[] | undefined;
  /** Nombre de la variable de entorno en la que va la credencial. */
  variableDelSecreto: string;
  /**
   * Variable en la que va la credencial de confirmación, distinta de la anterior.
   * Solo se rellena en la conexión efímera de una escritura aprobada (ADR-031).
   */
  variableDeConfirmacion?: string | undefined;
  /** Resto del entorno del hijo. Por defecto, ninguno: un hijo hereda lo mínimo. */
  entorno?: Record<string, string> | undefined;
  directorio?: string | undefined;
}

/**
 * Lanza el conector como proceso hijo y habla con él por entrada y salida estándar.
 *
 * El entorno del hijo se construye desde cero y no se hereda del padre. Es más
 * trabajo y es lo correcto: un conector no tiene por qué ver las credenciales de
 * los otros conectores ni la cadena de conexión de la base solo porque su proceso
 * padre las tenga.
 */
export async function conexionPorProcesoHijo(
  nombreConector: string,
  secreto: Secreto | null,
  opciones: OpcionesProcesoHijo,
  confirmacion?: Secreto,
): Promise<ConexionMcp> {
  if (confirmacion !== undefined) {
    const variable = opciones.variableDeConfirmacion ?? '';
    if (variable === '' || variable === opciones.variableDelSecreto) {
      // Nunca se descarta en silencio ni se mezcla con la del agente: dos
      // credenciales, dos nombres.
      throw new Error(
        `El conector «${nombreConector}» recibe una credencial de confirmación y no declara una variable propia para ella.`,
      );
    }
  }
  const entorno: Record<string, string> = {
    // `PATH` sí hace falta: sin él no se encuentra el mandato.
    PATH: process.env['PATH'] ?? '',
    ...(opciones.entorno ?? {}),
    ...(secreto === null ? {} : { [opciones.variableDelSecreto]: secreto.revelar() }),
    ...(confirmacion === undefined || !opciones.variableDeConfirmacion
      ? {}
      : { [opciones.variableDeConfirmacion]: confirmacion.revelar() }),
  };

  const transporte = new StdioClientTransport({
    command: opciones.comando,
    args: [...(opciones.argumentos ?? [])],
    env: entorno,
    ...(opciones.directorio === undefined ? {} : { cwd: opciones.directorio }),
    // El conector escribe sus trazas en el error estándar; se heredan para que
    // salgan en los registros del trabajador y no se pierdan. El gateway no filtra
    // ese flujo: lo que un conector vuelque ahí sale en claro, así que un conector
    // no escribe en él ni su entorno ni su credencial. Está en el runbook como
    // responsabilidad del conector.
    stderr: 'inherit',
  });

  return conectarPorMcp(transporte, nombreConector);
}

export interface OpcionesHttp {
  url: string;
  /** Cabeceras además de la de autorización. No llevan secretos. */
  cabeceras?: Record<string, string> | undefined;
  /** Esquema de la cabecera de autorización. `Bearer` salvo que el servicio pida otro. */
  esquemaAutorizacion?: string | undefined;
}

/** Habla con un conector que ya está corriendo en otro sitio, por HTTP transmisible. */
export async function conexionPorHttp(
  nombreConector: string,
  secreto: Secreto | null,
  opciones: OpcionesHttp,
): Promise<ConexionMcp> {
  const esquema = opciones.esquemaAutorizacion ?? 'Bearer';
  const cabeceras: Record<string, string> = {
    ...(opciones.cabeceras ?? {}),
    ...(secreto === null ? {} : { authorization: `${esquema} ${secreto.revelar()}` }),
  };

  const transporte = new StreamableHTTPClientTransport(new URL(opciones.url), {
    requestInit: { headers: cabeceras },
  });

  return conectarPorMcp(transporte, nombreConector);
}
