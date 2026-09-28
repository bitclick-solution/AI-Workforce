/**
 * Identidad del panel: las tablas que usa Better Auth (ADR-002).
 *
 * El acceso ocurre antes de saber el tenant: quien pide un enlace da un correo, y
 * quien presenta una cookie da un token. Por eso estas tablas no las lee el rol de
 * aplicación, `aiw_app`, sino un rol propio, `aiw_identidad`, con una política que
 * le deja ver todas las filas de estas cinco tablas y ningún permiso sobre las
 * demás. `aiw_app` no tiene permiso sobre ninguna de ellas: una consulta de negocio
 * no puede leer un token de sesión, ni siquiera de su propio tenant.
 *
 * - `usuario` es la identidad: un correo único en toda la plataforma, enlazado a
 *   una `persona` de un tenant. Durante la alfa, una persona por usuario.
 * - `sesion` lleva `tenant_id` y `persona_id`, que un disparador copia de `usuario`
 *   al insertar: ni Better Auth ni la aplicación pueden elegirlos. De aquí sale el
 *   tenant que la API fija en la RLS.
 * - `cuenta` la exige Better Auth; aquí no hay contraseñas ni OAuth, y la
 *   migración lo impone con un `check`.
 * - `verificacion` guarda los enlaces por correo y los retos de WebAuthn, con el
 *   identificador en hash. Es estado previo a la autenticación: no tiene tenant.
 * - `clave_acceso` guarda las passkeys: la clave pública, nunca la privada.
 *
 * Los nombres de las propiedades son los que Better Auth mapea en
 * `apps/api/src/identidad/acceso.ts`; las columnas, en español como el resto.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { columnasMutables, idPrimario, tenantId } from './columnas.js';
import { organizacion, persona } from './organizacion.js';

/** Rol con el que corre Better Auth. Lo crea la migración `0005_acceso_al_panel`. */
export const ROL_IDENTIDAD = 'aiw_identidad';

const momento = (nombre: string) => timestamp(nombre, { withTimezone: true });

/** Identidad global: un correo, una persona de un tenant. */
export const usuario = pgTable(
  'usuario',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'restrict' }),
    nombre: text('nombre').notNull(),
    /** En minúsculas: la migración lo impone con un `check`. */
    correo: text('correo').notNull(),
    correoVerificado: boolean('correo_verificado').notNull().default(false),
    imagen: text('imagen'),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('usuario_correo_key').on(t.correo),
    uniqueIndex('usuario_persona_key').on(t.personaId),
    index('usuario_tenant_idx').on(t.tenantId, t.creadoEn),
  ],
);

/** Sesión del panel. `tenant_id` y `persona_id` los pone un disparador desde `usuario`. */
export const sesion = pgTable(
  'sesion',
  {
    id: idPrimario(),
    tenantId: tenantId().references(() => organizacion.id, { onDelete: 'restrict' }),
    personaId: uuid('persona_id')
      .notNull()
      .references(() => persona.id, { onDelete: 'restrict' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    token: text('token').notNull(),
    caducaEn: momento('caduca_en').notNull(),
    ip: text('ip'),
    agenteUsuario: text('agente_usuario'),
    ...columnasMutables(),
  },
  (t) => [
    uniqueIndex('sesion_token_key').on(t.token),
    index('sesion_tenant_idx').on(t.tenantId, t.creadoEn),
    index('sesion_usuario_idx').on(t.usuarioId),
  ],
);

/**
 * Cuenta de Better Auth. El acceso es por enlace y por passkey: ninguna fila lleva
 * contraseña ni tokens de OAuth, y la migración rechaza la que lo intente.
 */
export const cuenta = pgTable(
  'cuenta',
  {
    id: idPrimario(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    cuentaId: text('cuenta_id').notNull(),
    proveedorId: text('proveedor_id').notNull(),
    tokenAcceso: text('token_acceso'),
    tokenRefresco: text('token_refresco'),
    tokenIdentidad: text('token_identidad'),
    tokenAccesoCaducaEn: momento('token_acceso_caduca_en'),
    tokenRefrescoCaducaEn: momento('token_refresco_caduca_en'),
    alcance: text('alcance'),
    contrasena: text('contrasena'),
    ...columnasMutables(),
  },
  (t) => [index('cuenta_usuario_idx').on(t.usuarioId)],
);

/**
 * Enlaces por correo y retos de WebAuthn. Identificador en hash y caducidad corta.
 *
 * El `id` es texto: Better Auth reserva el un solo uso insertando una fila con un
 * `id` derivado del token, y es la clave primaria la que hace chocar al segundo.
 */
export const verificacion = pgTable(
  'verificacion',
  {
    id: text('id')
      .primaryKey()
      .default(sql`uuid_generar_v7()::text`),
    identificador: text('identificador').notNull(),
    valor: text('valor').notNull(),
    caducaEn: momento('caduca_en').notNull(),
    ...columnasMutables(),
  },
  (t) => [index('verificacion_identificador_idx').on(t.identificador)],
);

/** Passkey de un usuario: clave pública y contador de firmas. */
export const claveAcceso = pgTable(
  'clave_acceso',
  {
    id: idPrimario(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'restrict' }),
    nombre: text('nombre'),
    clavePublica: text('clave_publica').notNull(),
    credencialId: text('credencial_id').notNull(),
    contador: bigint('contador', { mode: 'number' }).notNull(),
    tipoDispositivo: text('tipo_dispositivo').notNull(),
    respaldada: boolean('respaldada').notNull(),
    transportes: text('transportes'),
    aaguid: text('aaguid'),
    creadoEn: momento('creado_en').default(sql`now()`),
  },
  (t) => [
    uniqueIndex('clave_acceso_credencial_key').on(t.credencialId),
    index('clave_acceso_usuario_idx').on(t.usuarioId),
  ],
);

/** El esquema que recibe el adaptador de Drizzle de Better Auth, por nombre de modelo. */
export const ESQUEMA_IDENTIDAD = {
  usuario,
  sesion,
  cuenta,
  verificacion,
  claveAcceso,
} as const;
