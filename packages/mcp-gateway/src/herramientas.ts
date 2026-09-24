/**
 * Registro de herramientas: qué es una herramienta y de qué clase es.
 *
 * Frontera del ADR-001: «registro de herramientas como interfaz con descubrimiento
 * en runtime». El descubrimiento se hace contra el servidor MCP cada vez que se
 * abre la conexión, no contra una lista escrita en el código de la plataforma: por
 * eso cambiar el conector de Odoo por el de demostración no toca ni una línea del
 * bucle del agente.
 *
 * La clasificación en lectura o escritura la declara el servidor con las
 * anotaciones del protocolo y la aplica la plataforma. El modelo no participa: si
 * el modelo pudiera decir «esto es una lectura», la tabla de políticas no serviría
 * para nada.
 */
import type { TipoClaseAccion } from '@aiw/domain';

/** Clave de `_meta` con la que un servidor MCP puede declarar su clase de acción. */
export const META_CLASE = 'aiw.clase';

export interface HerramientaDescubierta {
  nombre: string;
  descripcion: string;
  /** Lo que le hace al mundo. Decide si «en prueba» la simula. */
  tipo: TipoClaseAccion;
  /** Clave con la que se busca el nivel en la política. Por defecto, el tipo. */
  claseAccion: string;
  /** Esquema JSON de los argumentos, tal como lo publica el servidor. */
  esquemaEntrada: unknown;
  /** Conector que la sirve. Va a la auditoría junto al nombre de la herramienta. */
  conector: string;
}

/** Lo que devuelve una llamada, ya normalizado a texto. */
export interface ResultadoHerramienta {
  texto: string;
  /** Cierto cuando el servidor respondió con `isError`. El gateway lo convierte en error. */
  esError: boolean;
  estructurado?: unknown;
}

/**
 * Herramienta MCP tal como llega por el protocolo. Se declara el mínimo que se usa
 * en vez de importar el tipo del SDK: así este módulo no obliga a nadie a conocer
 * la versión del SDK para clasificar una herramienta.
 */
export interface HerramientaMcp {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean | undefined } | undefined;
  _meta?: Record<string, unknown> | undefined;
}

/**
 * Clasifica una herramienta descubierta.
 *
 * Sin `readOnlyHint` explícito se supone escritura. Es el valor más restrictivo a
 * propósito: una herramienta que no dice lo que hace no se trata como inofensiva.
 */
export function clasificar(herramienta: HerramientaMcp, conector: string): HerramientaDescubierta {
  const tipo: TipoClaseAccion =
    herramienta.annotations?.readOnlyHint === true ? 'lectura' : 'escritura';
  const declarada = herramienta._meta?.[META_CLASE];
  return {
    nombre: herramienta.name,
    descripcion: herramienta.description ?? '',
    tipo,
    claseAccion: typeof declarada === 'string' && declarada.trim() !== '' ? declarada : tipo,
    esquemaEntrada: herramienta.inputSchema ?? { type: 'object', properties: {} },
    conector,
  };
}

/** Conexión abierta contra un servidor MCP. La abre el gateway y la cierra el gateway. */
export interface ConexionMcp {
  listar(): Promise<HerramientaDescubierta[]>;
  llamar(nombre: string, argumentos: Record<string, unknown>): Promise<ResultadoHerramienta>;
  cerrar(): Promise<void>;
}
