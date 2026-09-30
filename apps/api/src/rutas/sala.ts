/**
 * Rutas de la sala v0: leer la sala general, escribir en ella y decidir una
 * propuesta de operación con un clic.
 *
 * Detrás de bandera y token, igual que el contador: sin `AIW_SALA_V0=1` y sin
 * `AIW_SALA_TOKEN`, las rutas no existen. El tenant y la persona salen de la sesión
 * del panel que la API valida en el servidor («Acceso al panel»); una cabecera que
 * diga otra cosa se ignora.
 *
 * Escribir no escribe: arranca el flujo `mensajeDeSala` o señala el de la
 * propuesta. Toda escritura la hace el trabajador dentro de una actividad, con su
 * entrada en el libro. Así la API no es un segundo punto de escritura de nada.
 *
 * Como el contador, se parte en dos: `atenderSala` no sabe de PostgreSQL ni de
 * Temporal y se prueba con un puerto falso; `puertoSala` es el de verdad.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { conTenant, uuidV7 } from '@aiw/db';
import {
  DURACION_ESCRIBIENDO_MS,
  FLUJO_MENSAJE_DE_SALA,
  LONGITUD_MAXIMA_MENSAJE,
  NOMBRE_SALA_GENERAL,
  SEGUNDOS_TOKEN_CENTRIFUGO,
  SENAL_DECISION_PROPUESTA,
  calcularEstadoDePresencia,
  canalDeSala,
  idFlujoMensaje,
  idFlujoPropuesta,
  mencionaAPersona,
  type CargaDecisionPropuesta,
  type EntradaMensajeDeSala,
  type EstadoDePresencia,
} from '@aiw/rooms';
// Aparte del índice del paquete: usa `node:crypto` y el índice lo importa el
// paquete de flujos de Temporal, que se empaqueta para un entorno sin él.
import {
  ErrorCentrifugo,
  presenciaDeSala,
  publicarEnSala,
  tokenDeCanal,
  tokenDeConexion,
  type BuscadorCentrifugo,
  type ConfiguracionCentrifugo,
} from '@aiw/rooms/centrifugo';
import type postgres from 'postgres';

import { SIN_SESION, type ResolutorDeSesion } from '../identidad/acceso.js';
import type { RespuestaContador } from './contador.js';

export const BANDERA_SALA = 'AIW_SALA_V0';
/** Sala v1: salas por equipo y presencia en vivo por Centrifugo (ADR-022). */
export const BANDERA_SALA_V1 = 'AIW_SALA_V1';
export const VARIABLE_TOKEN_SALA = 'AIW_SALA_TOKEN';
export const PREFIJO_SALA = '/sala';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_MENSAJES = 100;

export interface ConfiguracionSalaV1 {
  centrifugo: ConfiguracionCentrifugo;
}

export interface ConfiguracionSala {
  token: string;
  temporal: { direccion: string; espacio: string; cola: string };
  /** Ausente sin `AIW_SALA_V1` o sin la configuración de Centrifugo: las rutas de la v1 no existen. */
  v1?: ConfiguracionSalaV1 | undefined;
}

export function configuracionSalaDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionSala | undefined {
  if (entorno[BANDERA_SALA] !== '1' && entorno[BANDERA_SALA] !== 'true') return undefined;
  const token = entorno[VARIABLE_TOKEN_SALA]?.trim();
  if (!token) return undefined;

  const v1Activa = entorno[BANDERA_SALA_V1] === '1' || entorno[BANDERA_SALA_V1] === 'true';
  const urlApi = entorno['AIW_CENTRIFUGO_URL']?.trim();
  const claveApi = entorno['CENTRIFUGO_API_KEY']?.trim();
  const secretoHmac = entorno['CENTRIFUGO_TOKEN_HMAC_SECRET_KEY']?.trim();
  const v1 =
    v1Activa && urlApi && claveApi && secretoHmac
      ? { centrifugo: { urlApi, claveApi, secretoHmac } }
      : undefined;

  return {
    token,
    temporal: {
      direccion: entorno['AIW_TEMPORAL_DIRECCION']?.trim() || 'localhost:7233',
      espacio: entorno['AIW_TEMPORAL_ESPACIO']?.trim() || 'default',
      cola: entorno['AIW_TEMPORAL_COLA']?.trim() || 'aiw-prueba-stack',
    },
    ...(v1 ? { v1 } : {}),
  };
}

export interface MensajeDeLaVista {
  id: string;
  cuerpo: string;
  autor: { tipo: 'persona' | 'puesto' | 'plataforma'; nombre: string };
  adjuntos: unknown[];
  creadoEn: string;
}

export interface PropuestaDeLaVista {
  id: string;
  resumen: string;
  estado: string;
  nivelExigido: string;
  costeEstimadoEuros: number;
  efectos: unknown;
}

export interface ResumenSalaDeLaVista {
  id: string;
  nombre: string;
  ambito: 'general' | 'equipo';
  sinLeer: number;
  menciones: number;
}

export interface MiembroDeLaVista {
  id: string;
  tipo: 'persona' | 'agente';
  nombre: string;
  puesto?: string;
  estado: EstadoDePresencia;
  /** ISO 8601: desde cuándo está en ese estado, cuando se conoce. */
  desde?: string;
}

export interface TokenDeSalaDeLaVista {
  /** Token de conexión de Centrifugo. */
  token: string;
  /** Token de suscripción, solo para el canal de esta sala. */
  canalToken: string;
  canal: string;
}

/** Lo que la ruta necesita de fuera. Se inyecta para probarla sin base ni Temporal. */
export interface PuertoSala {
  salaGeneral(tenantId: string): Promise<string | null>;
  personaActiva(tenantId: string, personaId: string): Promise<boolean>;
  mensajes(tenantId: string, salaId: string, limite: number): Promise<MensajeDeLaVista[]>;
  propuestas(tenantId: string, ids: string[]): Promise<PropuestaDeLaVista[]>;
  arrancarMensaje(entrada: EntradaMensajeDeSala): Promise<void>;
  decidirPropuesta(propuestaId: string, carga: CargaDecisionPropuesta): Promise<void>;
  // Sala v1: salas por equipo y presencia en vivo (ADR-022).
  /** Si la persona es participante de la sala. Base de la privacidad de la presencia. */
  esMiembro(tenantId: string, salaId: string, personaId: string): Promise<boolean>;
  /** Las salas de las que la persona es participante, con sin leer y menciones. */
  salasDeLaPersona(tenantId: string, personaId: string): Promise<ResumenSalaDeLaVista[]>;
  /** Los miembros de una sala, con el estado ya calculado (`@aiw/rooms`). */
  miembrosDeSala(tenantId: string, salaId: string): Promise<MiembroDeLaVista[]>;
  /** Marca que la persona ha leído la sala hasta ahora. */
  marcarLeido(tenantId: string, salaId: string, personaId: string): Promise<void>;
  /** Token de conexión y de canal, o nulo si la persona no es miembro de la sala. */
  tokenDeSala(
    tenantId: string,
    salaId: string,
    personaId: string,
  ): Promise<TokenDeSalaDeLaVista | null>;
  /** Publicación efímera de «escribiendo»: no se guarda ni entra en el libro. */
  avisarEscribiendo(tenantId: string, salaId: string, personaId: string): Promise<void>;
}

export interface PeticionSala {
  metodo: string | undefined;
  url: string | undefined;
  cabeceras: Record<string, string | string[] | undefined>;
  cuerpo?: unknown;
}

const SIN_CACHE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function respuesta(estado: number, cuerpo: Record<string, unknown>): RespuestaContador {
  return { estado, cuerpo, cabeceras: { ...SIN_CACHE } };
}

function cabecera(peticion: PeticionSala, nombre: string): string | undefined {
  const valor = peticion.cabeceras[nombre];
  return (Array.isArray(valor) ? valor[0] : valor)?.trim();
}

function tokenCorrecto(esperado: string, peticion: PeticionSala): boolean {
  const [tipo, ...resto] = (cabecera(peticion, 'authorization') ?? '').split(/\s+/);
  const recibido = resto.join(' ').trim();
  if (tipo?.toLowerCase() !== 'bearer' || recibido.length === 0) return false;
  const a = createHash('sha256').update(esperado, 'utf8').digest();
  const b = createHash('sha256').update(recibido, 'utf8').digest();
  return timingSafeEqual(a, b);
}

function campo(cuerpo: unknown, nombre: string): unknown {
  return typeof cuerpo === 'object' && cuerpo !== null
    ? (cuerpo as Record<string, unknown>)[nombre]
    : undefined;
}

/**
 * Sala pedida por consulta o por cuerpo; sin ella, la sala general (v0 y v1).
 * Una sala pedida explícitamente exige ser miembro (privacidad de la sala v1,
 * decisión 2 de la especificación): sin este control, cualquier persona activa
 * del tenant podía leer y escribir en la sala de cualquier equipo con solo
 * conocer su UUID.
 */
async function resolverSalaPorDefecto(
  puerto: PuertoSala,
  tenantId: string,
  personaId: string,
  pedida: string | undefined,
): Promise<string | { error: RespuestaContador }> {
  if (pedida !== undefined) {
    if (!UUID.test(pedida)) {
      return { error: respuesta(400, { error: 'salaId tiene que ser un UUID.' }) };
    }
    if (!(await puerto.esMiembro(tenantId, pedida, personaId))) {
      return { error: respuesta(403, { error: 'Solo los miembros de la sala acceden a ella.' }) };
    }
    return pedida;
  }
  const general = await puerto.salaGeneral(tenantId);
  if (!general) {
    return { error: respuesta(404, { error: 'La organización no tiene sala general.' }) };
  }
  return general;
}

export async function atenderSala(
  peticion: PeticionSala,
  configuracion: ConfiguracionSala | undefined,
  puerto: PuertoSala,
  resolverSesion: ResolutorDeSesion = SIN_SESION,
): Promise<RespuestaContador | undefined> {
  const [caminoSinConsulta = '/', consulta = ''] = (peticion.url ?? '/').split('?');
  const camino = caminoSinConsulta;
  if (camino !== PREFIJO_SALA && !camino.startsWith(`${PREFIJO_SALA}/`)) return undefined;
  if (!configuracion) return undefined;

  if (!tokenCorrecto(configuracion.token, peticion)) {
    return {
      estado: 401,
      cuerpo: { error: 'Falta el token de la sala o no es el que toca.' },
      cabeceras: { ...SIN_CACHE, 'www-authenticate': 'Bearer' },
    };
  }
  const sesion = await resolverSesion(peticion.cabeceras);
  if (!sesion) return respuesta(401, { error: 'Hace falta una sesión del panel.' });
  const { tenantId, personaId } = sesion;
  if (!(await puerto.personaActiva(tenantId, personaId))) {
    return respuesta(403, { error: 'La persona no está activa en esta organización.' });
  }

  if (camino === PREFIJO_SALA) {
    if (peticion.metodo !== 'GET') return respuesta(405, { error: 'La sala se lee con GET.' });
    const pedida = new URLSearchParams(consulta).get('salaId') ?? undefined;
    const resuelta = await resolverSalaPorDefecto(puerto, tenantId, personaId, pedida);
    if (typeof resuelta !== 'string') return resuelta.error;
    const salaId = resuelta;
    const mensajes = await puerto.mensajes(tenantId, salaId, LIMITE_MENSAJES);
    const ids = [
      ...new Set(
        mensajes.flatMap((m) =>
          m.adjuntos
            .map((a) => campo(a, 'propuestaId'))
            .filter((id): id is string => typeof id === 'string'),
        ),
      ),
    ];
    return respuesta(200, { salaId, mensajes, propuestas: await puerto.propuestas(tenantId, ids) });
  }

  if (camino === `${PREFIJO_SALA}/mensajes`) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se escribe con POST.' });
    const texto = campo(peticion.cuerpo, 'texto');
    if (typeof texto !== 'string' || texto.trim().length === 0) {
      return respuesta(400, { error: 'Falta el texto del mensaje.' });
    }
    if (texto.length > LONGITUD_MAXIMA_MENSAJE) {
      return respuesta(413, {
        error: `El mensaje pasa de ${LONGITUD_MAXIMA_MENSAJE} caracteres.`,
      });
    }
    const salaIdPedida = campo(peticion.cuerpo, 'salaId');
    const resuelta = await resolverSalaPorDefecto(
      puerto,
      tenantId,
      personaId,
      typeof salaIdPedida === 'string' ? salaIdPedida : undefined,
    );
    if (typeof resuelta !== 'string') return resuelta.error;
    const salaId = resuelta;
    const mensajeId = uuidV7();
    await puerto.arrancarMensaje({ tenantId, salaId, mensajeId, personaId, texto: texto.trim() });
    return respuesta(202, { mensajeId });
  }

  const decision = /^\/sala\/propuestas\/([^/]+)\/decision$/.exec(camino);
  if (decision) {
    if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se decide con POST.' });
    const propuestaId = decision[1] ?? '';
    const sentido = campo(peticion.cuerpo, 'sentido');
    if (!UUID.test(propuestaId) || (sentido !== 'aprobada' && sentido !== 'rechazada')) {
      return respuesta(400, {
        error: 'Hace falta una propuesta válida y sentido aprobada o rechazada.',
      });
    }
    const [propuesta] = await puerto.propuestas(tenantId, [propuestaId]);
    if (!propuesta) return respuesta(404, { error: 'Esa propuesta no existe.' });
    if (propuesta.estado !== 'pendiente') {
      return respuesta(409, { error: `La propuesta ya está ${propuesta.estado}.` });
    }
    await puerto.decidirPropuesta(propuestaId, { personaId, sentido });
    return respuesta(202, { propuestaId, sentido });
  }

  // Sala v1: sin AIW_SALA_V1 o sin la configuración de Centrifugo, ninguna de
  // estas rutas existe (mismo criterio que el resto de la sala sin bandera).
  if (configuracion.v1) {
    if (camino === `${PREFIJO_SALA}/salas`) {
      if (peticion.metodo !== 'GET') return respuesta(405, { error: 'Las salas se leen con GET.' });
      const salas = await puerto.salasDeLaPersona(tenantId, personaId);
      return respuesta(200, { salas });
    }

    const miembros = /^\/sala\/([^/]+)\/miembros$/.exec(camino);
    if (miembros) {
      const salaId = miembros[1] ?? '';
      if (!UUID.test(salaId)) return respuesta(400, { error: 'salaId tiene que ser un UUID.' });
      if (peticion.metodo !== 'GET') {
        return respuesta(405, { error: 'Los miembros se leen con GET.' });
      }
      if (!(await puerto.esMiembro(tenantId, salaId, personaId))) {
        return respuesta(403, {
          error: 'Solo los miembros de la sala ven su presencia.',
        });
      }
      return respuesta(200, { miembros: await puerto.miembrosDeSala(tenantId, salaId) });
    }

    const token = /^\/sala\/([^/]+)\/token$/.exec(camino);
    if (token) {
      const salaId = token[1] ?? '';
      if (!UUID.test(salaId)) return respuesta(400, { error: 'salaId tiene que ser un UUID.' });
      if (peticion.metodo !== 'POST')
        return respuesta(405, { error: 'El token se pide con POST.' });
      const emitido = await puerto.tokenDeSala(tenantId, salaId, personaId);
      if (!emitido) {
        return respuesta(403, { error: 'Solo los miembros de la sala reciben su token.' });
      }
      return respuesta(200, { ...emitido });
    }

    const leido = /^\/sala\/([^/]+)\/leido$/.exec(camino);
    if (leido) {
      const salaId = leido[1] ?? '';
      if (!UUID.test(salaId)) return respuesta(400, { error: 'salaId tiene que ser un UUID.' });
      if (peticion.metodo !== 'POST') return respuesta(405, { error: 'Se marca leído con POST.' });
      if (!(await puerto.esMiembro(tenantId, salaId, personaId))) {
        return respuesta(403, { error: 'Solo un miembro marca la sala como leída.' });
      }
      await puerto.marcarLeido(tenantId, salaId, personaId);
      return respuesta(200, { ok: true });
    }

    const escribiendo = /^\/sala\/([^/]+)\/escribiendo$/.exec(camino);
    if (escribiendo) {
      const salaId = escribiendo[1] ?? '';
      if (!UUID.test(salaId)) return respuesta(400, { error: 'salaId tiene que ser un UUID.' });
      if (peticion.metodo !== 'POST') {
        return respuesta(405, { error: 'Se avisa de que se escribe con POST.' });
      }
      if (!(await puerto.esMiembro(tenantId, salaId, personaId))) {
        return respuesta(403, { error: 'Solo un miembro avisa de que está escribiendo.' });
      }
      await puerto.avisarEscribiendo(tenantId, salaId, personaId);
      return respuesta(200, { ok: true });
    }
  }

  return respuesta(404, { error: 'Esa ruta de la sala no existe.' });
}

/** Cliente de Temporal mínimo que usa la ruta. Se inyecta para no abrir conexión al importar. */
export interface ClienteDeFlujos {
  arrancar(nombre: string, opciones: { cola: string; id: string; args: unknown[] }): Promise<void>;
  senalar(id: string, senal: string, carga: unknown): Promise<void>;
}

/** Puerto real: lecturas con el tenant fijado en la transacción y flujos por nombre. */
export function puertoSala(
  cliente: postgres.Sql,
  flujos: ClienteDeFlujos,
  configuracion: ConfiguracionSala,
  /** Cliente HTTP de Centrifugo. Por defecto, `fetch`; las pruebas inyectan el suyo. */
  buscarCentrifugo: BuscadorCentrifugo = fetch as unknown as BuscadorCentrifugo,
): PuertoSala {
  // Última actividad conocida de cada persona, solo en memoria de este proceso: la
  // presencia de las personas no se guarda, ni en PostgreSQL ni en el libro (ADR-022,
  // «fuera de alcance»). Se pierde al reiniciar la API, que es justo lo que toca:
  // nadie queda «en la sala» para siempre por culpa de una fila que sobrevivió.
  const ultimaActividadPorPersona = new Map<string, number>();
  const claveActividad = (tenantId: string, personaId: string) => `${tenantId}:${personaId}`;
  const registrarActividad = (tenantId: string, personaId: string): void => {
    ultimaActividadPorPersona.set(claveActividad(tenantId, personaId), Date.now());
  };
  const ultimaActividad = (tenantId: string, personaId: string): number | null =>
    ultimaActividadPorPersona.get(claveActividad(tenantId, personaId)) ?? null;

  return {
    async salaGeneral(tenantId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ id: string }[]>`
        select id from sala where tenant_id = ${tenantId} and nombre = ${NOMBRE_SALA_GENERAL}
      `,
      );
      return fila?.id ?? null;
    },
    async personaActiva(tenantId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ activa: boolean }[]>`
        select activa from persona where tenant_id = ${tenantId} and id = ${personaId}
      `,
      );
      return fila?.activa === true;
    },
    async mensajes(tenantId, salaId, limite) {
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            cuerpo: string;
            persona: string | null;
            puesto: string | null;
            adjuntos: unknown[];
            creado_en: Date;
          }[]
        >`
        select * from (
          select m.id, m.cuerpo, pe.nombre as persona, pu.nombre as puesto, m.adjuntos, m.creado_en
          from mensaje m
          left join persona pe on pe.tenant_id = m.tenant_id and pe.id = m.autor_persona_id
          left join puesto pu on pu.tenant_id = m.tenant_id and pu.id = m.autor_puesto_id
          where m.tenant_id = ${tenantId} and m.sala_id = ${salaId}
          order by m.creado_en desc, m.id desc
          limit ${limite}
        ) ultimos order by creado_en, id
      `,
      );
      return filas.map((fila) => {
        const plataforma = fila.adjuntos
          .map((a) => campo(a, 'agente'))
          .find((agente) => typeof agente === 'string');
        const autor: MensajeDeLaVista['autor'] = fila.persona
          ? { tipo: 'persona', nombre: fila.persona }
          : fila.puesto
            ? { tipo: 'puesto', nombre: fila.puesto }
            : {
                tipo: 'plataforma',
                nombre: plataforma === 'moderador' ? 'Moderador' : 'Director de IA',
              };
        return {
          id: fila.id,
          cuerpo: fila.cuerpo,
          autor,
          // `decisionCompleta` es para el reintento del flujo, no para la vista.
          adjuntos: fila.adjuntos.map((a) => {
            if (typeof a !== 'object' || a === null) return a;
            const { decisionCompleta: _omitida, ...resto } = a as Record<string, unknown>;
            return resto;
          }),
          creadoEn: fila.creado_en.toISOString(),
        };
      });
    },
    async propuestas(tenantId, ids) {
      if (ids.length === 0) return [];
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            resumen: string;
            estado: string;
            nivel_exigido: string;
            coste_estimado_euros: string;
            efectos_previstos: unknown;
          }[]
        >`
        select id, resumen, estado, nivel_exigido, coste_estimado_euros, efectos_previstos
        from propuesta_operacion
        where tenant_id = ${tenantId} and id in ${tx(ids)}
      `,
      );
      return filas.map((fila) => ({
        id: fila.id,
        resumen: fila.resumen,
        estado: fila.estado,
        nivelExigido: fila.nivel_exigido,
        costeEstimadoEuros: Number(fila.coste_estimado_euros),
        efectos: fila.efectos_previstos,
      }));
    },
    async arrancarMensaje(entrada) {
      await flujos.arrancar(FLUJO_MENSAJE_DE_SALA, {
        cola: configuracion.temporal.cola,
        id: idFlujoMensaje(entrada.mensajeId),
        args: [entrada],
      });
    },
    async decidirPropuesta(propuestaId, carga) {
      await flujos.senalar(idFlujoPropuesta(propuestaId), SENAL_DECISION_PROPUESTA, carga);
    },

    // Sala v1: salas por equipo y presencia en vivo (ADR-022).

    async esMiembro(tenantId, salaId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ existe: boolean }[]>`
        select exists(
          select 1 from sala_participante
          where tenant_id = ${tenantId} and sala_id = ${salaId} and persona_id = ${personaId}
        ) as existe
      `,
      );
      return fila?.existe === true;
    },

    async salasDeLaPersona(tenantId, personaId) {
      registrarActividad(tenantId, personaId);
      const [persona] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ nombre: string }[]>`
        select nombre from persona where tenant_id = ${tenantId} and id = ${personaId}
      `,
      );
      const nombrePersona = persona?.nombre ?? '';

      const salas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            id: string;
            nombre: string;
            departamento_id: string | null;
            ultima_lectura_en: Date | null;
          }[]
        >`
        select s.id, s.nombre, s.departamento_id, sp.ultima_lectura_en
        from sala_participante sp
        join sala s on s.tenant_id = sp.tenant_id and s.id = sp.sala_id
        where sp.tenant_id = ${tenantId} and sp.persona_id = ${personaId}
        order by s.nombre
      `,
      );

      const resumenes: ResumenSalaDeLaVista[] = [];
      for (const sala of salas) {
        const sinLeer = await conTenant(
          cliente,
          tenantId,
          (tx) => tx<{ cuerpo: string }[]>`
          select cuerpo from mensaje
          where tenant_id = ${tenantId} and sala_id = ${sala.id}
            and autor_persona_id is distinct from ${personaId}
            and (${sala.ultima_lectura_en}::timestamptz is null or creado_en > ${sala.ultima_lectura_en})
        `,
        );
        resumenes.push({
          id: sala.id,
          nombre: sala.nombre,
          ambito: sala.departamento_id ? 'equipo' : 'general',
          sinLeer: sinLeer.length,
          menciones: sinLeer.filter((m) => mencionaAPersona(nombrePersona, m.cuerpo)).length,
        });
      }
      return resumenes;
    },

    async miembrosDeSala(tenantId, salaId) {
      const filas = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<
          {
            persona_id: string | null;
            puesto_id: string | null;
            persona_nombre: string | null;
            puesto_nombre: string | null;
            puesto_estado: string | null;
          }[]
        >`
        select sp.persona_id, sp.puesto_id, pe.nombre as persona_nombre,
          pu.nombre as puesto_nombre, pu.estado as puesto_estado
        from sala_participante sp
        left join persona pe on pe.tenant_id = sp.tenant_id and pe.id = sp.persona_id
        left join puesto pu on pu.tenant_id = sp.tenant_id and pu.id = sp.puesto_id
        where sp.tenant_id = ${tenantId} and sp.sala_id = ${salaId}
        order by coalesce(pe.nombre, pu.nombre)
      `,
      );

      const puestoIds = filas.map((f) => f.puesto_id).filter((id): id is string => id !== null);

      const trabajando = new Set<string>(
        puestoIds.length === 0
          ? []
          : (
              await conTenant(
                cliente,
                tenantId,
                (tx) => tx<{ puesto_id: string }[]>`
              select distinct puesto_id from tarea
              where tenant_id = ${tenantId} and puesto_id in ${tx(puestoIds)} and estado = 'en_curso'
            `,
              )
            ).map((f) => f.puesto_id),
      );
      // Pendiente: la aprobación no tiene fila en decision_aprobacion todavía (ADR-005).
      const necesitan = new Set<string>(
        puestoIds.length === 0
          ? []
          : (
              await conTenant(
                cliente,
                tenantId,
                (tx) => tx<{ puesto_id: string }[]>`
              select distinct t.puesto_id
              from aprobacion a
              join tarea t on t.tenant_id = a.tenant_id and t.id = a.tarea_id
              left join decision_aprobacion d on d.tenant_id = a.tenant_id and d.aprobacion_id = a.id
              where a.tenant_id = ${tenantId} and t.puesto_id in ${tx(puestoIds)} and d.id is null
            `,
              )
            ).map((f) => f.puesto_id),
      );

      // Sin Centrifugo o con Centrifugo caído, ninguna persona se ve conectada: se
      // pintan como «añadidas» en vez de romper la sala (criterio de hecho: la sala
      // sigue funcionando con consulta periódica).
      let conectadas = new Set<string>();
      if (configuracion.v1) {
        try {
          const presencia = await presenciaDeSala(
            configuracion.v1.centrifugo,
            tenantId,
            salaId,
            buscarCentrifugo,
          );
          conectadas = new Set(presencia.map((p) => p.personaId));
        } catch (error) {
          // Fallo 5: Centrifugo caído (fetch rechaza) es la caída de verdad que
          // ya cubre este `catch` a propósito; que Centrifugo responda que no
          // (canal rechazado, `ErrorCentrifugo`) es un fallo de configuración y
          // se registra, nunca en silencio, aunque la sala siga degradando igual.
          if (error instanceof ErrorCentrifugo) {
            console.error(`[api] centrifugo rechazó la presencia de ${salaId}: ${error.message}`);
          }
          conectadas = new Set();
        }
      }

      const ahoraMs = Date.now();
      return filas.map((fila): MiembroDeLaVista => {
        if (fila.puesto_id) {
          const estado = calcularEstadoDePresencia({
            tipo: 'agente',
            estadoPuesto: fila.puesto_estado ?? 'activo',
            tareaEnCurso: trabajando.has(fila.puesto_id),
            aprobacionPendiente: necesitan.has(fila.puesto_id),
            ahoraMs,
          });
          return { id: fila.puesto_id, tipo: 'agente', nombre: fila.puesto_nombre ?? '', estado };
        }
        const personaId = fila.persona_id ?? '';
        const estado = calcularEstadoDePresencia({
          tipo: 'persona',
          conectada: conectadas.has(personaId),
          ultimaActividadMs: ultimaActividad(tenantId, personaId),
          ahoraMs,
        });
        return { id: personaId, tipo: 'persona', nombre: fila.persona_nombre ?? '', estado };
      });
    },

    async marcarLeido(tenantId, salaId, personaId) {
      registrarActividad(tenantId, personaId);
      await conTenant(
        cliente,
        tenantId,
        (tx) => tx`
        update sala_participante set ultima_lectura_en = clock_timestamp(), actualizado_en = clock_timestamp()
        where tenant_id = ${tenantId} and sala_id = ${salaId} and persona_id = ${personaId}
      `,
      );
    },

    async tokenDeSala(tenantId, salaId, personaId) {
      const [fila] = await conTenant(
        cliente,
        tenantId,
        (tx) => tx<{ existe: boolean }[]>`
        select exists(
          select 1 from sala_participante
          where tenant_id = ${tenantId} and sala_id = ${salaId} and persona_id = ${personaId}
        ) as existe
      `,
      );
      if (fila?.existe !== true) return null;
      registrarActividad(tenantId, personaId);
      if (!configuracion.v1) throw new Error('Sala v1 no está configurada.');
      const { secretoHmac } = configuracion.v1.centrifugo;
      return {
        token: tokenDeConexion(secretoHmac, {
          personaId,
          tenantId,
          ttlSegundos: SEGUNDOS_TOKEN_CENTRIFUGO,
        }),
        canalToken: tokenDeCanal(secretoHmac, {
          personaId,
          tenantId,
          salaId,
          ttlSegundos: SEGUNDOS_TOKEN_CENTRIFUGO,
        }),
        canal: canalDeSala(tenantId, salaId),
      };
    },

    async avisarEscribiendo(tenantId, salaId, personaId) {
      registrarActividad(tenantId, personaId);
      if (!configuracion.v1) return;
      await publicarEnSala(
        configuracion.v1.centrifugo,
        tenantId,
        salaId,
        {
          tipo: 'escribiendo',
          personaId,
          hasta: new Date(Date.now() + DURACION_ESCRIBIENDO_MS).toISOString(),
        },
        buscarCentrifugo,
      );
    },
  };
}
