/**
 * Better Auth para el panel: enlace por correo y passkey (ADR-002).
 *
 * Qué decide este módulo y por qué:
 *
 * - **Sin registro abierto.** El enlace por correo lleva `disableSignUp`: solo entra
 *   un correo que ya es `usuario`, y un usuario solo lo crea la invitación de
 *   Bitclick (`invitar.ts`). A un correo desconocido no se le manda nada y la
 *   respuesta es la misma, así que la pantalla de acceso no dice quién está dentro.
 * - **El tenant sale del usuario, no del cliente.** Al crear la sesión, el gancho
 *   copia `tenantId` y `personaId` del usuario; en la base, un disparador vuelve a
 *   copiarlos y rechaza cualquier cambio. `resolverSesion` devuelve ese tenant, y
 *   es el único que las rutas de datos fijan en la RLS.
 * - **Sesión de duración fija.** Sin renovación deslizante ni caché en cookie: cada
 *   petición mira la base, un cierre de sesión vale desde ese momento y una sesión
 *   caducada se borra al presentarse.
 * - **Auditoría que no se salta.** Si la entrada del inicio de sesión no se escribe,
 *   la sesión se borra y el error llega a quien entraba: no hay cookie sin entrada.
 *   El cierre no se bloquea nunca por el libro —salir siempre tiene que funcionar—;
 *   si el libro falla, queda en el registro del proceso.
 * - **Credenciales fuera.** Los identificadores de verificación se guardan con hash;
 *   el secreto llega envuelto y solo se revela al construir Better Auth.
 */
import { passkey } from '@better-auth/passkey';
import {
  ESQUEMA_IDENTIDAD,
  ROL_IDENTIDAD,
  conTenant,
  identificadorSeguro,
  uuidV7,
  type BaseDeDatos,
} from '@aiw/db';
import type { PuertoDeCorreo } from '@aiw/domain';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';
import type postgres from 'postgres';

import { ACCIONES_ACCESO, METODOS_ACCESO, type AnotadorDeAcceso } from './auditoria.js';
import type { ConfiguracionAcceso } from './configuracion.js';
import { correoDeEnlace } from './correo.js';

/** Ruta base de Better Auth en la API y en el panel, que la reenvía tal cual. */
export const RUTA_ACCESO = '/api/auth';

/** Prefijo de las cookies: `aiw.session_token`. El panel solo reenvía estas. */
export const PREFIJO_COOKIE = 'aiw';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UsuarioDelAcceso {
  id: string;
  tenantId: string;
  personaId: string;
  nombre: string;
  correo: string;
}

/** Lo que el acceso necesita saber de la base, fuera de lo que lee Better Auth. */
export interface PuertoIdentidad {
  usuarioPorId(id: string): Promise<UsuarioDelAcceso | null>;
  usuarioPorCorreo(correo: string): Promise<UsuarioDelAcceso | null>;
  /** La persona está activa y su organización también. */
  personaHabilitada(tenantId: string, personaId: string): Promise<boolean>;
  /** Borra una sesión que no llegó a anotarse. */
  descartarSesion(id: string): Promise<void>;
}

/** Sesión que la API da por buena: de aquí, y solo de aquí, sale el tenant. */
export interface SesionValidada {
  sesionId: string;
  usuarioId: string;
  tenantId: string;
  personaId: string;
  nombre: string;
  correo: string;
  caducaEn: Date;
}

export type Cabeceras = Record<string, string | string[] | undefined>;

/** Resuelve la sesión de una petición, o `null` si no hay una válida. */
export type ResolutorDeSesion = (cabeceras: Cabeceras) => Promise<SesionValidada | null>;

/** Sin acceso configurado no hay sesión posible. */
export const SIN_SESION: ResolutorDeSesion = () => Promise.resolve(null);

export interface OpcionesAcceso {
  configuracion: ConfiguracionAcceso;
  /** Drizzle sobre una conexión con el rol `aiw_identidad`. */
  dbIdentidad: BaseDeDatos;
  puerto: PuertoIdentidad;
  anotador: AnotadorDeAcceso;
  correo: PuertoDeCorreo;
}

/**
 * Campos de la cuenta de Better Auth y la propiedad de `cuenta` que los guarda.
 * Son nombres de columna, no valores: van como pares para que el detector de
 * secretos no confunda `token` con una credencial escrita.
 */
const CAMPOS_CUENTA = Object.fromEntries([
  ['accountId', 'cuentaId'],
  ['providerId', 'proveedorId'],
  ['userId', 'usuarioId'],
  ['accessToken', 'tokenAcceso'],
  ['refreshToken', 'tokenRefresco'],
  ['idToken', 'tokenIdentidad'],
  ['accessTokenExpiresAt', 'tokenAccesoCaducaEn'],
  ['refreshTokenExpiresAt', 'tokenRefrescoCaducaEn'],
  ['scope', 'alcance'],
  ['password', 'contrasena'],
  ['createdAt', 'creadoEn'],
  ['updatedAt', 'actualizadoEn'],
]);

/** Una secuencia larga de base64url o hexadecimal: puede ser un token o su hash. */
const PARECE_TOKEN = /[A-Za-z0-9_-]{24,}/g;

/**
 * Lo que se puede registrar de un error del acceso: su nombre y el código de
 * PostgreSQL si lo hay. Nunca el mensaje, que en un fallo de consulta lleva los
 * parámetros.
 */
export function descripcionSaneada(error: unknown): string {
  if (!(error instanceof Error)) return 'error desconocido';
  const causa = (error as { cause?: { code?: unknown } }).cause;
  const codigo =
    (error as { code?: unknown }).code ?? (typeof causa === 'object' ? causa?.code : undefined);
  return typeof codigo === 'string' ? `${error.name} (${codigo})` : error.name;
}

/** Registro de Better Auth: el mensaje sin parámetros ni nada con pinta de token. */
export function registroSaneado(nivel: string, mensaje: unknown): void {
  const texto = String(mensaje).split(/params:/i)[0] ?? '';
  console.error(
    `[api] better-auth ${nivel}: ${texto.replace(PARECE_TOKEN, '«oculto»').slice(0, 300)}`,
  );
}

function metodoDe(ruta: string | undefined): string {
  if (ruta?.startsWith('/magic-link')) return METODOS_ACCESO.enlace;
  if (ruta?.startsWith('/passkey')) return METODOS_ACCESO.passkey;
  return METODOS_ACCESO.desconocido;
}

function camposDeSesion(sesion: Record<string, unknown>) {
  const tenantId = typeof sesion['tenantId'] === 'string' ? sesion['tenantId'] : '';
  const personaId = typeof sesion['personaId'] === 'string' ? sesion['personaId'] : '';
  const id = typeof sesion['id'] === 'string' ? sesion['id'] : '';
  const usuarioId = typeof sesion['userId'] === 'string' ? sesion['userId'] : '';
  const caducaEn = sesion['expiresAt'] instanceof Date ? sesion['expiresAt'] : new Date(0);
  return { id, usuarioId, tenantId, personaId, caducaEn };
}

/** Lo que el servidor usa del acceso: atender `/api/auth/*` y resolver sesiones. */
export interface Acceso {
  /** Atiende una petición de Better Auth. */
  manejar(peticion: Request): Promise<Response>;
  resolverSesion: ResolutorDeSesion;
}

export function crearAcceso(opciones: OpcionesAcceso): Acceso {
  const { configuracion, puerto, anotador, correo } = opciones;
  const urlPublica = new URL(configuracion.urlPublica);

  const auth = betterAuth({
    appName: 'AI Workforce',
    baseURL: configuracion.urlPublica,
    basePath: RUTA_ACCESO,
    secret: configuracion.secreto.revelar(),
    telemetry: { enabled: false },
    // Los errores suben hasta `manejar`, que registra solo nombre y código: el
    // mensaje de Drizzle lleva los parámetros de la consulta, y entre ellos puede
    // ir un token de sesión.
    onAPIError: { throw: true },
    logger: { level: 'warn', log: registroSaneado },
    database: drizzleAdapter(opciones.dbIdentidad, {
      provider: 'pg',
      schema: { ...ESQUEMA_IDENTIDAD },
    }),
    emailAndPassword: { enabled: false },
    user: {
      modelName: 'usuario',
      fields: {
        name: 'nombre',
        email: 'correo',
        emailVerified: 'correoVerificado',
        image: 'imagen',
        createdAt: 'creadoEn',
        updatedAt: 'actualizadoEn',
      },
      additionalFields: {
        tenantId: { type: 'string', required: false, input: false },
        personaId: { type: 'string', required: false, input: false },
      },
    },
    session: {
      modelName: 'sesion',
      fields: {
        userId: 'usuarioId',
        expiresAt: 'caducaEn',
        ipAddress: 'ip',
        userAgent: 'agenteUsuario',
        createdAt: 'creadoEn',
        updatedAt: 'actualizadoEn',
      },
      additionalFields: {
        tenantId: { type: 'string', required: false, input: false },
        personaId: { type: 'string', required: false, input: false },
      },
      expiresIn: Math.round(configuracion.horasSesion * 3600),
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'cuenta',
      fields: CAMPOS_CUENTA,
      accountLinking: { enabled: false },
    },
    verification: {
      modelName: 'verificacion',
      fields: {
        identifier: 'identificador',
        value: 'valor',
        expiresAt: 'caducaEn',
        createdAt: 'creadoEn',
        updatedAt: 'actualizadoEn',
      },
      storeIdentifier: 'hashed',
    },
    advanced: {
      cookiePrefix: PREFIJO_COOKIE,
      useSecureCookies: urlPublica.protocol === 'https:',
      database: { generateId: () => uuidV7() },
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn: Math.round(configuracion.minutosEnlace * 60),
        async sendMagicLink({ email, url }) {
          const usuario = await puerto.usuarioPorCorreo(email.toLowerCase());
          // Correo no invitado o persona apagada: no se manda nada y se responde
          // igual, para no decir desde fuera quién tiene acceso.
          if (!usuario) return;
          if (!(await puerto.personaHabilitada(usuario.tenantId, usuario.personaId))) return;
          await correo.enviar(
            correoDeEnlace(
              configuracion.correo.remitente,
              usuario.correo,
              url,
              configuracion.minutosEnlace,
            ),
          );
          await anotador(usuario.tenantId, {
            accion: ACCIONES_ACCESO.enlaceEnviado,
            actorTipo: 'plataforma',
            herramienta: METODOS_ACCESO.enlace,
            datos: [
              { tipo: 'usuario', id: usuario.id },
              { tipo: 'persona', id: usuario.personaId },
            ],
          });
        },
      }),
      passkey({
        rpID: urlPublica.hostname,
        rpName: 'AI Workforce',
        origin: urlPublica.origin,
        schema: {
          passkey: {
            modelName: 'claveAcceso',
            fields: {
              name: 'nombre',
              publicKey: 'clavePublica',
              userId: 'usuarioId',
              credentialID: 'credencialId',
              counter: 'contador',
              deviceType: 'tipoDispositivo',
              backedUp: 'respaldada',
              transports: 'transportes',
              createdAt: 'creadoEn',
              aaguid: 'aaguid',
            },
          },
        },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          async before(sesion) {
            const usuario = await puerto.usuarioPorId(sesion.userId);
            if (!usuario) return false;
            if (!(await puerto.personaHabilitada(usuario.tenantId, usuario.personaId))) {
              return false;
            }
            return {
              data: { ...sesion, tenantId: usuario.tenantId, personaId: usuario.personaId },
            };
          },
          async after(sesion, contexto) {
            const campos = camposDeSesion(sesion);
            try {
              await anotador(campos.tenantId, {
                accion: ACCIONES_ACCESO.sesionIniciada,
                actorTipo: 'persona',
                actorId: campos.personaId,
                herramienta: metodoDe(contexto?.path),
                datos: [
                  { tipo: 'sesion', id: campos.id },
                  { tipo: 'usuario', id: campos.usuarioId },
                ],
              });
            } catch (error) {
              // Sin entrada no hay sesión: se borra antes de que llegue a la cookie.
              await puerto.descartarSesion(campos.id);
              throw error;
            }
          },
        },
        delete: {
          async before(sesion) {
            const campos = camposDeSesion(sesion);
            const caducada = campos.caducaEn.getTime() <= Date.now();
            try {
              await anotador(campos.tenantId, {
                accion: caducada ? ACCIONES_ACCESO.sesionCaducada : ACCIONES_ACCESO.sesionCerrada,
                actorTipo: caducada ? 'sistema' : 'persona',
                actorId: caducada ? null : campos.personaId,
                datos: [
                  { tipo: 'sesion', id: campos.id },
                  { tipo: 'usuario', id: campos.usuarioId },
                ],
              });
            } catch (error) {
              // Salir tiene que funcionar siempre: el fallo queda en el registro del
              // proceso, sin datos de la sesión.
              console.error(
                '[api] el cierre de sesión no se pudo anotar:',
                error instanceof Error ? error.message : 'error desconocido',
              );
            }
          },
        },
      },
    },
  });

  const resolverSesion: ResolutorDeSesion = async (cabeceras) => {
    const cookie = cabeceras['cookie'];
    const valor = Array.isArray(cookie) ? cookie.join('; ') : cookie;
    if (!valor) return null;
    let resultado: Awaited<ReturnType<typeof auth.api.getSession>>;
    try {
      resultado = await auth.api.getSession({ headers: new Headers({ cookie: valor }) });
    } catch (error) {
      // Sin `cause` a propósito: la causa lleva los parámetros de la consulta, y
      // quien registre este error no debe poder volcarlos.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`La sesión no se pudo comprobar: ${descripcionSaneada(error)}.`);
    }
    if (!resultado) return null;
    const campos = camposDeSesion(resultado.session as unknown as Record<string, unknown>);
    if (!UUID.test(campos.tenantId) || !UUID.test(campos.personaId)) return null;
    if (campos.caducaEn.getTime() <= Date.now()) return null;
    // Una persona desactivada pierde el acceso en la siguiente petición.
    if (!(await puerto.personaHabilitada(campos.tenantId, campos.personaId))) return null;
    return {
      sesionId: campos.id,
      usuarioId: campos.usuarioId,
      tenantId: campos.tenantId,
      personaId: campos.personaId,
      nombre: resultado.user.name,
      correo: resultado.user.email,
      caducaEn: campos.caducaEn,
    };
  };

  return {
    async manejar(peticion) {
      try {
        return await auth.handler(peticion);
      } catch (error) {
        console.error(`[api] el acceso falló: ${descripcionSaneada(error)}`);
        return Response.json(
          { error: 'El acceso falló. Vuelve a intentarlo.' },
          { status: 500, headers: { 'cache-control': 'no-store' } },
        );
      }
    },
    resolverSesion,
  };
}

/** Puerto real: `usuario` con el rol de identidad; persona y organización, con el de aplicación. */
export function puertoIdentidad(
  clienteIdentidad: postgres.Sql,
  clienteApp: postgres.Sql,
): PuertoIdentidad {
  const rol = identificadorSeguro(ROL_IDENTIDAD);
  const comoIdentidad = <T>(cuerpo: (tx: postgres.TransactionSql) => Promise<T>) =>
    clienteIdentidad.begin(async (tx) => {
      await tx.unsafe(`set local role ${rol}`);
      return cuerpo(tx);
    }) as Promise<T>;

  const leerUsuario = (
    filas: { id: string; tenant_id: string; persona_id: string; nombre: string; correo: string }[],
  ) => {
    const fila = filas[0];
    return fila
      ? {
          id: fila.id,
          tenantId: fila.tenant_id,
          personaId: fila.persona_id,
          nombre: fila.nombre,
          correo: fila.correo,
        }
      : null;
  };

  return {
    async usuarioPorId(id) {
      if (!UUID.test(id)) return null;
      return leerUsuario(
        await comoIdentidad(
          (tx) => tx<
            { id: string; tenant_id: string; persona_id: string; nombre: string; correo: string }[]
          >`
            select id, tenant_id, persona_id, nombre, correo from usuario where id = ${id}
          `,
        ),
      );
    },
    async usuarioPorCorreo(correo) {
      return leerUsuario(
        await comoIdentidad(
          (tx) => tx<
            { id: string; tenant_id: string; persona_id: string; nombre: string; correo: string }[]
          >`
            select id, tenant_id, persona_id, nombre, correo from usuario where correo = ${correo}
          `,
        ),
      );
    },
    async personaHabilitada(tenantId, personaId) {
      if (!UUID.test(tenantId) || !UUID.test(personaId)) return false;
      const [fila] = await conTenant(
        clienteApp,
        tenantId,
        (tx) => tx<{ activa: boolean; estado: string }[]>`
          select p.activa, o.estado
          from persona p
          join organizacion o on o.id = p.tenant_id
          where p.tenant_id = ${tenantId} and p.id = ${personaId}
        `,
      );
      return fila?.activa === true && fila.estado === 'activa';
    },
    async descartarSesion(id) {
      if (!UUID.test(id)) return;
      await comoIdentidad((tx) => tx`delete from sesion where id = ${id}`);
    },
  };
}
