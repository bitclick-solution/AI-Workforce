/**
 * Sala v0 en el panel: bandera, configuración y llamadas a la API.
 *
 * Igual que el contador: el navegador habla con los manejadores de ruta de Next y
 * son ellos los que ponen el token del panel y reenvían la cookie de sesión. El
 * tenant y la persona los decide la API al validar esa sesión («Acceso al panel»);
 * Next no manda ninguno. Desde «Sala v1 · conversación real», los tipos de los
 * mensajes y las propuestas son un `import` de `sala-contrato.ts` (el contrato
 * ganó la conversación); los de las salas, los miembros y la presencia ya lo
 * eran, porque `sala-contrato.ts` es justo lo que el Diseñador y esta rebanada
 * comparten (ADR-022).
 */
import { conectarACentrifugo, type ConexionCentrifugo } from './centrifugo-cliente';
import type {
  AdjuntoDeSala,
  CambioDeSala,
  EfectosDeContratacion,
  FuenteDeSala,
  MensajeDeSala,
  MiembroDeSala,
  PropuestaDeSala,
  ResumenDeSala,
} from './sala-contrato';

export const BANDERA_SALA = 'AIW_SALA_V0';

/**
 * Cada cuánto pregunta la vista mientras Centrifugo no haga el fan-out, y el
 * respaldo de `crearFuenteDeSala` si Centrifugo no responde o cae (criterio de
 * hecho: la sala sigue funcionando con consulta periódica).
 *
 * La bandera `AIW_SALA_V1` que decide si `/panel/sala` sirve esta fuente vive en
 * `./sala-bandera` (la puso el Diseñador): un solo sitio para no repetirla.
 */
export const SONDEO_SALA_MS = 2_000;

// `AdjuntoDeLaVista`, `MensajeDeLaSala` y `PropuestaDeLaSala` son alias de los
// tipos del contrato (`sala-contrato.ts`): desde la rebanada «Sala v1 ·
// conversación real», el contrato es la copia declarada del JSON de la API, y
// este fichero ya no redefine su forma por separado.
export type AdjuntoDeLaVista = AdjuntoDeSala;
export type MensajeDeLaSala = MensajeDeSala;
export type { EfectosDeContratacion };
export type PropuestaDeLaSala = PropuestaDeSala;

export interface DatosDeLaSala {
  salaId: string;
  mensajes: MensajeDeLaSala[];
  propuestas: PropuestaDeLaSala[];
}

export interface ConfiguracionSala {
  apiUrl: string;
  token: string;
}

export function salaActiva(entorno: Record<string, string | undefined>): boolean {
  return entorno[BANDERA_SALA] === '1' || entorno[BANDERA_SALA] === 'true';
}

export function configuracionSala(
  entorno: Record<string, string | undefined>,
): ConfiguracionSala | undefined {
  if (!salaActiva(entorno)) return undefined;
  const apiUrl = entorno['AIW_API_URL']?.trim();
  const token = entorno['AIW_SALA_TOKEN']?.trim();
  if (!apiUrl || !token) return undefined;
  return { apiUrl: apiUrl.replace(/\/+$/, ''), token };
}

/**
 * URL pública del WebSocket de Centrifugo, para que el navegador se conecte
 * directamente (sala v1). No es un secreto: el servidor de Next solo la añade a
 * la respuesta del token porque el navegador no lee variables de entorno.
 */
export function urlWebSocketCentrifugo(
  entorno: Record<string, string | undefined>,
): string | undefined {
  const url = entorno['AIW_CENTRIFUGO_WS_URL']?.trim();
  return url ? url : undefined;
}

export type BuscadorSala = (
  url: string,
  opciones: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

/**
 * Llama a la API con el token del panel y la cookie de sesión del navegador, y
 * devuelve estado y cuerpo; los errores salen saneados. `cookie` es la cabecera ya
 * filtrada a las cookies del acceso (`cookiesDelAcceso`).
 */
export async function llamarSala(
  configuracion: ConfiguracionSala,
  metodo: 'GET' | 'POST',
  ruta: string,
  buscar: BuscadorSala,
  cookie: string,
  cuerpo?: unknown,
): Promise<{ estado: number; cuerpo: unknown }> {
  let respuesta: Response;
  try {
    respuesta = await buscar(`${configuracion.apiUrl}${ruta}`, {
      method: metodo,
      headers: {
        authorization: `Bearer ${configuracion.token}`,
        ...(cookie ? { cookie } : {}),
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
    });
  } catch {
    // El motivo real puede llevar la dirección interna de la API: no sale al navegador.
    return { estado: 502, cuerpo: { error: 'La API de la sala no responde.' } };
  }
  const texto = await respuesta.text();
  let leido: unknown;
  try {
    leido = texto.length > 0 ? JSON.parse(texto) : {};
  } catch {
    leido = { error: 'La API de la sala respondió algo que no es JSON.' };
  }
  return { estado: respuesta.status, cuerpo: leido };
}

/** Quién firma un mensaje, como lo pinta la sala. */
export function etiquetaDeAutor(mensaje: MensajeDeLaSala): string {
  if (mensaje.autor.tipo === 'plataforma') return `${mensaje.autor.nombre} · plataforma`;
  if (mensaje.autor.tipo === 'puesto') return `${mensaje.autor.nombre} · agente`;
  return mensaje.autor.nombre;
}

/** La nota del moderador se pinta plegada (ADR-004: deliberaciones visibles plegadas). */
export function esNotaDelModerador(mensaje: MensajeDeLaSala): boolean {
  return mensaje.adjuntos.some((a) => a.tipo === 'moderacion');
}

export function propuestaDelMensaje(
  mensaje: MensajeDeLaSala,
  propuestas: PropuestaDeLaSala[],
): PropuestaDeLaSala | undefined {
  if (mensaje.autor.tipo !== 'plataforma') return undefined;
  const id = mensaje.adjuntos.find((a) => a.tipo === 'propuesta_operacion')?.propuestaId;
  return propuestas.find((p) => p.id === id);
}

/** Iniciales para el avatar: dos letras como máximo, sin tildes raras. */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter((p) => p.length > 0 && p[0] === p[0]?.toUpperCase());
  const elegidas = (palabras.length > 0 ? palabras : nombre.split(/\s+/)).slice(0, 2);
  return (
    elegidas
      .map((p) => p[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}

/** Hora corta de un mensaje, como en cualquier chat. */
export function horaCorta(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? ''
    : fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/**
 * La sala está «respondiendo» cuando lo último que se ve es de una persona: el
 * moderador y los agentes todavía no han contestado. La nota del moderador no
 * cuenta como respuesta, porque la intervención llega después.
 */
export function esperandoRespuesta(mensajes: MensajeDeLaSala[]): boolean {
  const ultimo = [...mensajes].reverse().find((m) => !esNotaDelModerador(m));
  return ultimo?.autor.tipo === 'persona';
}

// Sala v1: salas por equipo y presencia en vivo (ADR-022).
//
// `crearFuenteDeSala` implementa el contrato de `sala-contrato.ts` hablando solo
// con los manejadores de ruta de Next bajo `/api/sala/**`: son ellos los que
// ponen el token de la sala, el tenant y la persona (igual que el resto de esta
// rebanada), así que aquí nunca hace falta ni un secreto. La suscripción intenta
// Centrifugo primero y, si el token no llega, si Centrifugo no responde o si la
// conexión cae, se cae a la misma consulta periódica de siempre: la sala nunca
// se queda sin funcionar por su culpa (criterio de hecho).

interface TokenDeSalaDeLaVista {
  token: string;
  canalToken: string;
  canal: string;
  /** URL pública del WebSocket de Centrifugo. Sin ella, no se intenta conectar. */
  wsUrl?: string;
}

async function pedirJson<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(ruta, { ...opciones, cache: 'no-store' });
  if (!respuesta.ok) {
    throw new Error(`La API de la sala respondió ${respuesta.status} en ${ruta}.`);
  }
  return (await respuesta.json()) as T;
}

/** Publicación efímera de un mensaje o de «escribiendo», tal como la manda `apps/api`. */
function comoCambioDeSala(salaId: string, datos: unknown): CambioDeSala | undefined {
  if (typeof datos !== 'object' || datos === null) return undefined;
  const cuerpo = datos as Record<string, unknown>;
  if (cuerpo['tipo'] === 'mensaje') return { tipo: 'mensaje', salaId };
  if (
    cuerpo['tipo'] === 'escribiendo' &&
    typeof cuerpo['personaId'] === 'string' &&
    typeof cuerpo['hasta'] === 'string'
  ) {
    return { tipo: 'escribiendo', salaId, miembroId: cuerpo['personaId'], hasta: cuerpo['hasta'] };
  }
  return undefined;
}

/** Fuente real de la sala v1: la API por HTTP y Centrifugo por WebSocket. */
async function miembrosDeLaSala(salaId: string): Promise<MiembroDeSala[]> {
  const { miembros } = await pedirJson<{ miembros: MiembroDeSala[] }>(
    `/api/sala/${encodeURIComponent(salaId)}/miembros`,
  );
  return miembros;
}

/**
 * `POST` a los mismos manejadores de ruta que ya usa la vista v0
 * (`apps/web/app/api/sala/**`, sin duplicar el camino): si la respuesta no es
 * `ok`, lanza con el motivo que da la API o, si no viene, con el estado HTTP.
 */
async function postSala(ruta: string, cuerpo: unknown): Promise<void> {
  const respuesta = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    cache: 'no-store',
  });
  if (respuesta.ok) return;
  const leido = (await respuesta.json().catch(() => ({}))) as { error?: string };
  throw new Error(leido.error ?? `La API de la sala respondió ${respuesta.status}.`);
}

export function crearFuenteDeSala(): FuenteDeSala {
  return {
    async salas() {
      const { salas } = await pedirJson<{ salas: ResumenDeSala[] }>('/api/sala/salas');
      return salas;
    },

    miembros: miembrosDeLaSala,

    suscribir(salaId, alCambiar) {
      let activa = true;
      let conexion: ConexionCentrifugo | undefined;
      let sondeo: ReturnType<typeof setInterval> | undefined;

      const porConsultaPeriodica = (): void => {
        if (!activa || sondeo !== undefined) return;
        sondeo = setInterval(() => {
          if (activa) alCambiar({ tipo: 'mensaje', salaId });
        }, SONDEO_SALA_MS);
      };

      const alUnirseOSalir = (personaId: string): void => {
        void miembrosDeLaSala(salaId)
          .then((miembros) => {
            const miembro = miembros.find((m) => m.id === personaId);
            if (activa && miembro) alCambiar({ tipo: 'presencia', salaId, miembro });
          })
          .catch(() => undefined);
      };

      void (async () => {
        try {
          const emitido = await pedirJson<TokenDeSalaDeLaVista>(
            `/api/sala/${encodeURIComponent(salaId)}/token`,
            { method: 'POST' },
          );
          if (!activa) return;
          if (!emitido.wsUrl) {
            porConsultaPeriodica();
            return;
          }
          conexion = conectarACentrifugo({
            url: emitido.wsUrl,
            token: emitido.token,
            canal: emitido.canal,
            canalToken: emitido.canalToken,
            alPublicar: (datos) => {
              const cambio = comoCambioDeSala(salaId, datos);
              if (cambio) alCambiar(cambio);
            },
            alCambioDePresencia: alUnirseOSalir,
            alCaer: porConsultaPeriodica,
          });
        } catch {
          porConsultaPeriodica();
        }
      })();

      return () => {
        activa = false;
        conexion?.cerrar();
        if (sondeo !== undefined) clearInterval(sondeo);
      };
    },

    indicarEscritura(salaId) {
      void fetch(`/api/sala/${encodeURIComponent(salaId)}/escribiendo`, {
        method: 'POST',
        cache: 'no-store',
      }).catch(() => undefined);
    },

    // Sala v1: conversación real. Reutiliza el mismo proxy que ya usa la vista
    // v0 (`apps/web/app/api/sala/**`, que a su vez llama a `apps/api/src/rutas/
    // sala.ts`) en vez de abrir un camino nuevo: `GET /api/sala?salaId=` para
    // leer, `POST /api/sala/mensajes` para enviar y `POST /api/sala/propuestas/
    // :id/decision` para confirmar o descartar.

    async mensajes(salaId) {
      const datos = await pedirJson<{
        mensajes: MensajeDeSala[];
        propuestas: PropuestaDeSala[];
      }>(`/api/sala?salaId=${encodeURIComponent(salaId)}`);
      return { mensajes: datos.mensajes, propuestas: datos.propuestas };
    },

    async enviarMensaje(salaId, texto) {
      await postSala('/api/sala/mensajes', { texto, salaId });
    },

    async decidirPropuesta(propuestaId, sentido) {
      await postSala(`/api/sala/propuestas/${encodeURIComponent(propuestaId)}/decision`, {
        sentido,
      });
    },
  };
}
