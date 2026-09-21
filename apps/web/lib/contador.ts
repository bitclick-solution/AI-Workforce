/**
 * Panel del contador de tareas v0: bandera, lectura y formato.
 *
 * El panel habla con la API por HTTP y no importa `@aiw/ledger`: el contrato es el
 * JSON de las tres rutas, y meter el paquete del libro en un bundle de Next
 * arrastraría el driver de PostgreSQL al servidor del panel sin necesidad. Por eso
 * los tipos de aquí son una copia declarada del contrato, no un `import`.
 *
 * El token nunca llega al navegador: lo pone el manejador de ruta del servidor de
 * Next al llamar a la API, y el componente de cliente solo ve el resultado.
 */

/** Bandera de funcionalidad del panel. Apagada, la vista no existe. */
export const BANDERA_PANEL = 'AIW_PANEL_CONTADOR';

/** Cada cuánto vuelve a preguntar el panel mientras no exista el publicador de eventos. */
export const SONDEO_MS = 5_000;

/** A partir de aquí el panel avisa de que lo que muestra ya no es de ahora. */
export const TOLERANCIA_RANCIO_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ConsumoDelPeriodo {
  periodo: string;
  tareas: number;
  pasos: number;
  acciones: number;
  costeEuros: number;
  costeModelosEuros: number;
  ultimaAnotacion: number;
  momento: string;
}

export interface TareaDelPanel {
  tareaId: string;
  puesto: string;
  estado: string;
  origen: string;
  creadoEn: string;
  costeModelosEuros: number;
  usos: number;
  delegaciones: number;
}

export interface PuestoDelPanel {
  puestoId: string;
  puesto: string;
  costeModelosEuros: number;
  tokensEntrada: number;
  tokensSalida: number;
  usos: number;
}

export interface DatosDelContador {
  consumo: ConsumoDelPeriodo;
  tareas: TareaDelPanel[];
  porEstado: Record<string, number>;
  porPuesto: PuestoDelPanel[];
}

export interface ConfiguracionPanel {
  apiUrl: string;
  token: string;
  tenantId: string;
}

export function panelActivo(entorno: Record<string, string | undefined>): boolean {
  return entorno[BANDERA_PANEL] === '1' || entorno[BANDERA_PANEL] === 'true';
}

/**
 * Configuración del proxy, o `undefined` si falta algo.
 *
 * Mientras no haya identidad, el tenant del panel llega por entorno. Se valida como
 * UUID aquí para no mandar a la API una cabecera que solo puede acabar en un 400.
 */
export function configuracionPanel(
  entorno: Record<string, string | undefined>,
): ConfiguracionPanel | undefined {
  if (!panelActivo(entorno)) return undefined;
  const apiUrl = entorno['AIW_API_URL']?.trim();
  const token = entorno['AIW_CONTADOR_TOKEN']?.trim();
  const tenantId = entorno['AIW_PANEL_TENANT']?.trim();
  if (!apiUrl || !token || !tenantId || !UUID.test(tenantId)) return undefined;
  return { apiUrl: apiUrl.replace(/\/+$/, ''), token, tenantId };
}

type Buscador = (url: string, opciones: { headers: Record<string, string> }) => Promise<Response>;

async function pedirJson<T>(
  configuracion: ConfiguracionPanel,
  ruta: string,
  buscar: Buscador,
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await buscar(`${configuracion.apiUrl}${ruta}`, {
      headers: {
        authorization: `Bearer ${configuracion.token}`,
        'x-aiw-tenant': configuracion.tenantId,
      },
    });
  } catch {
    // El motivo real va al registro del servidor, no al navegador: puede llevar la
    // dirección interna de la API.
    throw new Error('La API del contador no responde.');
  }
  if (!respuesta.ok) {
    throw new Error(`La API del contador respondió ${respuesta.status}.`);
  }
  return (await respuesta.json()) as T;
}

/** Lee las tres rutas y devuelve lo que el panel pinta de una vez. */
export async function leerContador(
  configuracion: ConfiguracionPanel,
  buscar: Buscador,
): Promise<DatosDelContador> {
  const consumo = await pedirJson<ConsumoDelPeriodo>(configuracion, '/contador/periodo', buscar);
  const tareas = await pedirJson<{ tareas: TareaDelPanel[]; porEstado: Record<string, number> }>(
    configuracion,
    '/contador/tareas',
    buscar,
  );
  const puestos = await pedirJson<{ puestos: PuestoDelPanel[] }>(
    configuracion,
    '/contador/coste-por-puesto',
    buscar,
  );
  return {
    consumo,
    tareas: tareas.tareas,
    porEstado: tareas.porEstado,
    porPuesto: puestos.puestos,
  };
}

export function formatearEuros(valor: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Number.isFinite(valor) ? valor : 0);
}

export function formatearEntero(valor: number): string {
  return new Intl.NumberFormat('es-ES').format(Number.isFinite(valor) ? Math.trunc(valor) : 0);
}

/** «Tareas» en singular o plural, que es lo que se lee en un panel. */
export function etiquetaTareas(total: number): string {
  return total === 1 ? '1 tarea' : `${formatearEntero(total)} tareas`;
}

/**
 * ¿Lo que se muestra es de ahora?
 *
 * Con sondeo cada cinco segundos, treinta sin noticias significa que algo va mal
 * —la API no responde o el reloj del servidor se fue— y el panel lo dice en vez de
 * mostrar un número viejo como si fuera de ahora.
 */
export function esRancio(
  momentoIso: string,
  ahora: number = Date.now(),
  tolerancia: number = TOLERANCIA_RANCIO_MS,
): boolean {
  const momento = Date.parse(momentoIso);
  if (Number.isNaN(momento)) return true;
  return Math.abs(ahora - momento) > tolerancia;
}
