/**
 * Contexto de las actividades: lo que vive fuera del flujo.
 *
 * Las actividades son la mitad del trabajador que puede tener efectos: base de
 * datos, gateway MCP, proveedores de modelo, secretos. El flujo no ve nada de esto
 * y no debe: si el flujo pudiera abrir una conexión, dejaría de ser reproducible
 * desde su historial, que es lo único que hace durable a una tarea.
 *
 * Se construye una vez por proceso y se cierra al apagarlo. La demostración y las
 * pruebas construyen el suyo con el conector de demostración registrado; un proceso
 * de verdad registraría el conector de Odoo y un proveedor de modelo con clave, sin
 * tocar ni una línea del bucle.
 */
import { conTenant, crearConexion, type Conexion } from '@aiw/db';
import {
  NOMBRE_CONECTOR_DEMO,
  VARIABLE_SECRETO_DEMO,
  montarDemoEnMemoria,
} from '@aiw/connector-demo';
import {
  Gateway,
  RegistroDeServidores,
  conectarPorMcp,
  conexionPorHttp,
  conexionPorProcesoHijo,
  resolvedorDeEntorno,
  type ResolvedorDeSecretos,
} from '@aiw/mcp-gateway';
import {
  TrazasEnMemoria,
  crearCacheDePrompts,
  enrutadorDeGuiones,
  type CacheDePrompts,
  type Enrutador,
  type PuertoDeTrazas,
} from '@aiw/models';
import {
  publicarEnSala,
  type BuscadorCentrifugo,
  type ConfiguracionCentrifugo,
} from '@aiw/rooms/centrifugo';
import type postgres from 'postgres';

export interface OpcionesContexto {
  /** Cadena de conexión. Llega del entorno, nunca del código. */
  urlBaseDeDatos: string;
  /** Registro de servidores MCP. Sin valor, solo el conector de demostración. */
  registro?: RegistroDeServidores | undefined;
  enrutador?: Enrutador | undefined;
  secretos?: ResolvedorDeSecretos | undefined;
  trazas?: PuertoDeTrazas | undefined;
  /** Sala v1: reparto por Centrifugo. Sin ella, `avisarSala` no hace nada. */
  centrifugo?: ConfiguracionCentrifugo | undefined;
  /** Solo para pruebas: sustituye `fetch` al llamar al API HTTP de Centrifugo. */
  buscarCentrifugo?: BuscadorCentrifugo | undefined;
}

export interface ContextoDeActividades {
  cliente: postgres.Sql;
  gateway: Gateway;
  enrutador: Enrutador;
  cachePrompts: CacheDePrompts;
  trazas: PuertoDeTrazas;
  /**
   * Publica una publicación efímera en el canal de la sala: mensajes nuevos, para
   * que Centrifugo los reparta en vivo. Best-effort a propósito (ADR-022, «si
   * Centrifugo cae, la sala sigue funcionando»): sin `centrifugo` configurado, o
   * si la llamada falla, no hace nada y no lanza. El mensaje ya quedó escrito en
   * PostgreSQL en la misma transacción que lo anota; esto es solo el aviso en
   * vivo, nunca la verdad.
   */
  avisarSala: (tenantId: string, salaId: string, datos: Record<string, unknown>) => Promise<void>;
  cerrar: () => Promise<void>;
}

/**
 * Registro con el conector de demostración montado en memoria.
 *
 * El transporte se construye con la credencial ya dentro: el secreto va del
 * resolvedor a esta función y ahí se queda. Ni el gateway ni el bucle lo ven.
 */
export function registroConDemostracion(
  opciones: {
    fallosIniciales?: number | undefined;
    /**
     * Credencial que el servidor espera. Sin valor, la del entorno del proceso,
     * que es de donde saldría en el Compose. Las pruebas la pasan explícita para
     * no depender de lo que haya en el entorno del runner.
     */
    credencialEsperada?: string | undefined;
  } = {},
): RegistroDeServidores {
  return new RegistroDeServidores().registrar(NOMBRE_CONECTOR_DEMO, async (secreto) => {
    const { transporte } = await montarDemoEnMemoria({
      credencial: secreto?.revelar() ?? '',
      ...(opciones.credencialEsperada === undefined
        ? {}
        : { credencialEsperada: opciones.credencialEsperada }),
      ...(opciones.fallosIniciales === undefined
        ? {}
        : { fallosIniciales: opciones.fallosIniciales }),
    });
    return conectarPorMcp(transporte, NOMBRE_CONECTOR_DEMO);
  });
}

/**
 * Registro que lanza el conector de demostración como proceso hijo.
 *
 * Es la forma en la que va a estar el conector de Odoo si se despliega como
 * proceso: el gateway lo arranca y le inyecta la credencial en el entorno del hijo.
 * El entorno del hijo se construye desde cero, así que el conector no ve ni la
 * cadena de conexión de la base ni las credenciales de los otros conectores.
 */
export function registroConDemostracionPorProceso(opciones: {
  comando: string;
  argumentos: readonly string[];
  directorio?: string | undefined;
  fallosIniciales?: number | undefined;
}): RegistroDeServidores {
  return new RegistroDeServidores().registrar(NOMBRE_CONECTOR_DEMO, (secreto) =>
    conexionPorProcesoHijo(NOMBRE_CONECTOR_DEMO, secreto, {
      comando: opciones.comando,
      argumentos: opciones.argumentos,
      variableDelSecreto: VARIABLE_SECRETO_DEMO,
      ...(opciones.directorio === undefined ? {} : { directorio: opciones.directorio }),
      ...(opciones.fallosIniciales === undefined
        ? {}
        : { entorno: { DEMO_CONECTOR_FALLOS: String(opciones.fallosIniciales) } }),
    }),
  );
}

/**
 * Registro que habla con un conector ya arrancado, por HTTP transmisible.
 *
 * La credencial va en la cabecera de autorización, que la pone el gateway al abrir
 * la conexión. Es el camino del conector que vive en otra máquina.
 */
export function registroPorHttp(nombreConector: string, url: string): RegistroDeServidores {
  return new RegistroDeServidores().registrar(nombreConector, (secreto) =>
    conexionPorHttp(nombreConector, secreto, { url }),
  );
}

/**
 * Enrutador de la demostración y de las pruebas: el proveedor determinista, que
 * contesta a cada puesto con el guion de su modelo. Cobros y Conciliación hacen
 * cada uno su trabajo porque su `enrutado_modelo` dice modelos distintos.
 */
export function enrutadorDeDemostracion(): Enrutador {
  return enrutadorDeGuiones();
}

export function crearContextoDeActividades(opciones: OpcionesContexto): ContextoDeActividades {
  const conexion: Conexion = crearConexion({ url: opciones.urlBaseDeDatos });
  const registro = opciones.registro ?? registroConDemostracion();
  const gateway = new Gateway({
    cliente: conexion.cliente,
    registro,
    secretos: opciones.secretos ?? resolvedorDeEntorno(),
  });

  const buscarCentrifugo = opciones.buscarCentrifugo ?? (fetch as unknown as BuscadorCentrifugo);

  return {
    cliente: conexion.cliente,
    gateway,
    enrutador: opciones.enrutador ?? enrutadorDeDemostracion(),
    cachePrompts: crearCacheDePrompts(),
    trazas: opciones.trazas ?? new TrazasEnMemoria(),
    async avisarSala(tenantId, salaId, datos) {
      if (!opciones.centrifugo) return;
      try {
        await publicarEnSala(opciones.centrifugo, tenantId, salaId, datos, buscarCentrifugo);
      } catch (error) {
        console.error(
          '[worker] Centrifugo no repartió la publicación de la sala:',
          error instanceof Error ? error.message : error,
        );
      }
    },
    cerrar: async () => {
      await gateway.cerrar();
      await conexion.cerrar();
    },
  };
}

/** Atajo para las actividades: una transacción con el tenant fijado. */
export async function enTenant<T>(
  contexto: ContextoDeActividades,
  tenantId: string,
  cuerpo: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return conTenant(contexto.cliente, tenantId, cuerpo);
}
