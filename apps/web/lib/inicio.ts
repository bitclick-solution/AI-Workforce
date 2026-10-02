/**
 * Inicio del panel: bandera, contrato con la API y suscripción en tiempo real.
 *
 * El navegador solo habla con los manejadores de ruta de Next bajo `/api/inicio/**`
 * (igual que sala y contador): son ellos los que reenvían la cookie de sesión a la
 * API, que decide el tenant y la persona («Acceso al panel»). Los tipos de aquí son
 * una copia declarada del contrato JSON de `apps/api/src/rutas/inicio.ts`, no un
 * `import`, por la misma razón que en `contador.ts`: meter `@aiw/ledger` o
 * `@aiw/db` en el bundle del panel arrastraría el driver de PostgreSQL sin
 * necesidad.
 *
 * El estado de los agentes se actualiza en tiempo real reutilizando la conexión de
 * Centrifugo de Sala v1: `crearFuente()` de `./sala-fuente` (la misma que usa
 * `/panel/sala`, real o simulada según `?fuenteSimulada=1`) se suscribe a cada sala
 * de equipo, y cualquier cambio en ella (mensaje, presencia o el respaldo de
 * consulta periódica de `crearFuenteDeSala` cuando Centrifugo no responde)
 * dispara una relectura de `/api/inicio/agentes`. Esta rebanada no construye un
 * canal nuevo: encargar una tarea (`apps/api`) publica un aviso en ese mismo canal,
 * pero completar una tarea dentro del trabajador no publica nada todavía (fuera de
 * alcance: tocar `apps/worker` es de otra rebanada), así que el panel añade además
 * un refresco de respaldo cada `INTERVALO_RESPALDO_MS` para que «tu equipo» y «lo
 * último» no se queden nunca más de eso sin refrescar. Es una limitación conocida,
 * no un sondeo constante: se explica en el PR.
 */
import { cookiesDelAcceso } from './acceso';
import type { FuenteDeSala, ResumenDeSala } from './sala-contrato';

export const BANDERA_INICIO = 'AIW_INICIO_PANEL';

/** Respaldo de refresco mientras no exista el aviso de tarea completada (ver arriba). */
export const INTERVALO_RESPALDO_MS = 20_000;

export function inicioActivo(entorno: Record<string, string | undefined>): boolean {
  return entorno[BANDERA_INICIO] === '1' || entorno[BANDERA_INICIO] === 'true';
}

export interface ConfiguracionInicioWeb {
  apiUrl: string;
}

export function configuracionInicioWeb(
  entorno: Record<string, string | undefined>,
): ConfiguracionInicioWeb | undefined {
  if (!inicioActivo(entorno)) return undefined;
  const apiUrl = entorno['AIW_API_URL']?.trim();
  return apiUrl ? { apiUrl: apiUrl.replace(/\/+$/, '') } : undefined;
}

export interface TareaDelInicio {
  tareaId: string;
  encargo: string;
  estado: string;
  desde: string;
}

export interface AgenteDelInicio {
  puestoId: string;
  nombre: string;
  estado: string;
  departamentoId: string;
  departamento: string;
  salaId: string | null;
  origenPlantilla: boolean;
  tareaEnCurso: TareaDelInicio | null;
  ultimasCompletadas: TareaDelInicio[];
}

export interface AvisoDelInicio {
  aprobacionId: string;
  tareaId: string;
  puestoId: string;
  puesto: string;
  claseAccion: string;
  nivelExigido: string;
  resumenLegible: string;
  creadoEn: string;
}

export type ResultadoDePaso = 'exito' | 'error' | 'rechazado' | 'parcial';
export type TipoDePaso = 'arranque' | 'herramienta' | 'aprobacion_pedida' | 'decision';

export interface PasoDeLaTarea {
  orden: number;
  tipo: TipoDePaso;
  accion: string;
  herramienta: string | null;
  resultado: ResultadoDePaso;
  costeEuros: number;
  nivel: 'n0' | 'n1' | 'n2' | 'n3' | null;
  claseAccion: string | null;
  porque: string | null;
  creadoEn: string;
}

export interface AprobacionPendienteDeLaTarea {
  aprobacionId: string;
  claseAccion: string;
  nivelExigido: string;
  resumenLegible: string;
  creadoEn: string;
  venceEn: string | null;
  puedeDecidir: boolean;
}

export interface TareaDelegada {
  tareaId: string;
  tareaPadreId: string;
  encargo: string | null;
  estado: string;
  puestoId: string;
  agente: string;
  departamento: string;
  cruzaDepartamento: boolean;
  desde: string;
  costeEuros: number;
}

export interface DetalleDeTarea {
  tareaId: string;
  encargo: string;
  estado: string;
  puestoId: string;
  agente: string;
  departamento: string;
  desde: string;
  actualizadoEn: string;
  costeEuros: number;
  costeTotalEuros: number;
  delegadas: TareaDelegada[];
  pasos: PasoDeLaTarea[];
  aprobacionPendiente: AprobacionPendienteDeLaTarea | null;
}

/** Dónde vive el detalle de una tarea en el panel. */
export function rutaDelDetalle(tareaId: string): string {
  return `/panel/inicio/tarea/${encodeURIComponent(tareaId)}`;
}

export type Buscador = (url: string, opciones?: RequestInit) => Promise<Response>;

export async function pedirJson<T>(
  ruta: string,
  opciones: RequestInit,
  buscar: Buscador,
): Promise<T> {
  const respuesta = await buscar(ruta, { ...opciones, cache: 'no-store' });
  const cuerpo = (await respuesta.json().catch(() => ({}))) as T & { error?: string };
  if (!respuesta.ok) {
    throw new ErrorDelInicio(
      cuerpo.error ?? `El inicio respondió ${respuesta.status}.`,
      respuesta.status,
    );
  }
  return cuerpo;
}

export class ErrorDelInicio extends Error {
  readonly estado: number;
  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.estado = estado;
  }
}

export async function leerAgentes(buscar: Buscador = fetch): Promise<AgenteDelInicio[]> {
  const { agentes } = await pedirJson<{ agentes: AgenteDelInicio[] }>(
    '/api/inicio/agentes',
    {},
    buscar,
  );
  return agentes;
}

export async function leerAvisos(buscar: Buscador = fetch): Promise<AvisoDelInicio[]> {
  const { avisos } = await pedirJson<{ avisos: AvisoDelInicio[] }>(
    '/api/inicio/avisos',
    {},
    buscar,
  );
  return avisos;
}

export async function leerDetalleDeTarea(
  tareaId: string,
  buscar: Buscador = fetch,
): Promise<DetalleDeTarea> {
  const { tarea } = await pedirJson<{ tarea: DetalleDeTarea }>(
    `/api/inicio/tareas/${encodeURIComponent(tareaId)}`,
    {},
    buscar,
  );
  return tarea;
}

export async function encargarTarea(
  datos: { puestoId: string; encargo: string },
  buscar: Buscador = fetch,
): Promise<{ tareaId: string }> {
  return pedirJson(
    '/api/inicio/encargar',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(datos),
    },
    buscar,
  );
}

export async function decidirAviso(
  aprobacionId: string,
  sentido: 'aprobada' | 'rechazada',
  buscar: Buscador = fetch,
): Promise<{ aprobacionId: string; yaEstaba: boolean; sentido: string }> {
  return pedirJson(
    `/api/inicio/avisos/${encodeURIComponent(aprobacionId)}/decidir`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentido }),
    },
    buscar,
  );
}

/**
 * Se suscribe a la sala de cada equipo con la fuente ya conectada de Sala v1 y
 * llama a `alCambiar` con cualquier cambio (mensaje, presencia o el respaldo de
 * consulta periódica de la propia fuente). Si `fuente.salas()` falla —Sala v1 no
 * está activa, por ejemplo—, no lanza: el inicio sigue con el refresco de
 * respaldo. Devuelve la función para darse de baja de todo.
 */
export async function suscribirseAAgentesEnVivo(
  fuente: FuenteDeSala,
  alCambiar: () => void,
): Promise<() => void> {
  let salas: ResumenDeSala[];
  try {
    salas = await fuente.salas();
  } catch {
    return () => undefined;
  }
  const bajas = salas
    .filter((sala) => sala.ambito === 'equipo')
    .map((sala) => fuente.suscribir(sala.id, () => alCambiar()));
  return () => {
    for (const baja of bajas) baja();
  };
}

export type BuscadorDelServidor = (
  url: string,
  opciones: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

/**
 * Reenvía una petición de `/api/inicio/**` a la API con el token del panel, la
 * cookie de sesión del navegador y el ruta/método/cuerpo tal cual. El tenant y la
 * persona los decide la API a partir de la sesión: aquí nunca se manda ninguno.
 */
export async function reenviarInicio(
  ruta: string,
  metodo: 'GET' | 'POST',
  apiUrl: string,
  cabeceraCookie: string | null | undefined,
  buscar: BuscadorDelServidor,
  cuerpo?: unknown,
): Promise<Response> {
  const cookie = cookiesDelAcceso(cabeceraCookie);
  let respuesta: Response;
  try {
    respuesta = await buscar(`${apiUrl}${ruta}`, {
      method: metodo,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
  } catch {
    // El motivo real puede llevar la dirección interna de la API: no sale al navegador.
    return new Response(JSON.stringify({ error: 'El inicio no responde.' }), {
      status: 502,
      headers: SIN_CACHE,
    });
  }
  const texto = await respuesta.text();
  return new Response(texto.length > 0 ? texto : '{}', {
    status: respuesta.status,
    headers: SIN_CACHE,
  });
}
