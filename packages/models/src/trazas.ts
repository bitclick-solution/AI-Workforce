/**
 * Trazas del paso de modelo, con los cuatro datos que hacen falta para buscarlas.
 *
 * Langfuse recoge por el protocolo abierto de telemetría, así que el exportador es
 * configuración del proceso y no código de la plataforma: `OTEL_EXPORTER_*` apunta
 * al Langfuse del Compose y ya está. Lo que sí es código es qué lleva cada traza,
 * y eso no puede quedar al criterio de quien añada la siguiente llamada: tenant,
 * puesto, tarea y versión de puesto, siempre los cuatro.
 *
 * El puerto en memoria es el que corre en la integración continua. No es un doble
 * de usar y tirar: es lo que mira la prueba que rastrea el valor del secreto por
 * todo lo que sale hacia fuera.
 */

/** Atributos de una traza. Solo identificadores: ningún dato personal, ningún secreto. */
export interface AtributosDeTraza {
  tenantId: string;
  puestoId: string;
  versionPuestoId: string;
  tareaId: string;
  pasoId?: string | null | undefined;
  proveedor: string;
  modelo: string;
}

export interface TrazaDePaso extends AtributosDeTraza {
  nombre: string;
  duracionMs: number;
  tokensEntrada: number;
  tokensSalida: number;
  tokensEntradaCache: number;
  costeEuros: number;
  /** Cuántas herramientas se ofrecieron. El catálogo en sí no entra en la traza. */
  herramientasOfrecidas: number;
  /** Nombres de las herramientas que el modelo pidió. Sin argumentos. */
  herramientasPedidas: readonly string[];
}

export interface PuertoDeTrazas {
  registrar(traza: TrazaDePaso): void;
}

/** Guarda las trazas en el proceso. Es el proveedor por defecto y el de la CI. */
export class TrazasEnMemoria implements PuertoDeTrazas {
  readonly trazas: TrazaDePaso[] = [];

  registrar(traza: TrazaDePaso): void {
    this.trazas.push(traza);
  }

  get ultima(): TrazaDePaso | undefined {
    return this.trazas[this.trazas.length - 1];
  }

  vaciar(): void {
    this.trazas.length = 0;
  }
}

/** No registra nada. Para procesos donde la telemetría está apagada por completo. */
export const trazasApagadas: PuertoDeTrazas = { registrar: () => undefined };

/**
 * Metadatos que viajan con la llamada al modelo por la telemetría del AI SDK.
 *
 * Los nombres siguen la convención de Langfuse —`langfuse.*` para lo que su panel
 * entiende y el resto como metadatos libres—, así que una traza se encuentra
 * buscando por tenant, por puesto o por tarea sin preparar nada más.
 */
export function metadatosDeTelemetria(atributos: AtributosDeTraza): Record<string, string> {
  return {
    'langfuse.session.id': atributos.tareaId,
    'langfuse.user.id': atributos.tenantId,
    'aiw.tenant': atributos.tenantId,
    'aiw.puesto': atributos.puestoId,
    'aiw.version_puesto': atributos.versionPuestoId,
    'aiw.tarea': atributos.tareaId,
    ...(atributos.pasoId ? { 'aiw.paso': atributos.pasoId } : {}),
    'aiw.proveedor': atributos.proveedor,
    'aiw.modelo': atributos.modelo,
  };
}
