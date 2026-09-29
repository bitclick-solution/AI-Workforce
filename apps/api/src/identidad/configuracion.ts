/**
 * Configuración del acceso al panel, leída del entorno.
 *
 * La bandera `AIW_ACCESO_PANEL` manda. Apagada, la API no expone `/api/auth` y
 * nadie tiene sesión, así que las rutas de datos (sala y contador) responden 401:
 * el tenant ya no llega por cabecera, y sin sesión no hay tenant. Encendida, exige
 * el secreto de Better Auth de 32 caracteres o más y se niega a arrancar sin él.
 *
 * El secreto viaja envuelto en `Secreto`: no se imprime por accidente en un
 * registro ni en un mensaje de error.
 */
import { Secreto } from './secreto.js';

export const BANDERA_ACCESO = 'AIW_ACCESO_PANEL';
export const VARIABLE_SECRETO = 'AIW_ACCESO_SECRETO';
export const VARIABLE_URL_PUBLICA = 'AIW_WEB_URL_PUBLICA';

/** Longitud mínima del secreto con el que se firman las cookies de sesión. */
export const LONGITUD_MINIMA_SECRETO = 32;

/** Una jornada: sin renovación deslizante, la sesión dura esto desde que se abre. */
export const HORAS_SESION_POR_DEFECTO = 12;

/** Lo que vale un enlace de acceso: lo justo para abrir el correo y pulsar. */
export const MINUTOS_ENLACE_POR_DEFECTO = 15;

export const PROVEEDORES_CORREO = ['memoria', 'smtp'] as const;
export type ProveedorCorreo = (typeof PROVEEDORES_CORREO)[number];

export interface ConfiguracionSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  contrasena: Secreto;
}

export interface ConfiguracionCorreoAcceso {
  proveedor: ProveedorCorreo;
  remitente: string;
  smtp: ConfiguracionSmtp;
}

export interface ConfiguracionAcceso {
  /** URL del panel tal como la ve el navegador. De aquí salen los enlaces y el rpID. */
  urlPublica: string;
  secreto: Secreto;
  horasSesion: number;
  minutosEnlace: number;
  correo: ConfiguracionCorreoAcceso;
}

const ENCENDIDO = new Set(['1', 'true', 'si', 'sí']);

function texto(entorno: Record<string, string | undefined>, nombre: string, defecto: string) {
  const valor = entorno[nombre]?.trim();
  return valor && valor.length > 0 ? valor : defecto;
}

function positivo(entorno: Record<string, string | undefined>, nombre: string, defecto: number) {
  const valor = Number(entorno[nombre] ?? defecto);
  return Number.isFinite(valor) && valor > 0 ? valor : defecto;
}

export function accesoActivo(entorno: Record<string, string | undefined>): boolean {
  return ENCENDIDO.has((entorno[BANDERA_ACCESO] ?? '').trim().toLowerCase());
}

/**
 * Configuración del acceso, o `undefined` con la bandera apagada.
 *
 * Con la bandera encendida y un secreto que falta o es corto, lanza: arrancar una
 * API que firma cookies con un secreto débil es peor que no arrancar.
 */
export function configuracionAccesoDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionAcceso | undefined {
  if (!accesoActivo(entorno)) return undefined;

  const bruto = entorno[VARIABLE_SECRETO]?.trim() ?? '';
  if (bruto.length < LONGITUD_MINIMA_SECRETO || bruto === 'GENERAR') {
    throw new Error(
      `${BANDERA_ACCESO} está encendida y ${VARIABLE_SECRETO} falta o tiene menos de ${LONGITUD_MINIMA_SECRETO} caracteres. Genera uno con «openssl rand -base64 48».`,
    );
  }

  return {
    urlPublica: urlPublicaDesdeEntorno(entorno),
    secreto: new Secreto(bruto, VARIABLE_SECRETO),
    horasSesion: positivo(entorno, 'AIW_SESION_HORAS', HORAS_SESION_POR_DEFECTO),
    minutosEnlace: positivo(entorno, 'AIW_ACCESO_ENLACE_MINUTOS', MINUTOS_ENLACE_POR_DEFECTO),
    correo: correoDesdeEntorno(entorno),
  };
}

/** URL pública del panel. WebAuthn solo admite http en localhost; fuera, https. */
export function urlPublicaDesdeEntorno(entorno: Record<string, string | undefined>): string {
  let urlPublica: URL;
  try {
    urlPublica = new URL(texto(entorno, VARIABLE_URL_PUBLICA, 'http://localhost:3000'));
  } catch {
    throw new Error(`${VARIABLE_URL_PUBLICA} no es una URL.`);
  }
  if (urlPublica.protocol !== 'https:' && urlPublica.hostname !== 'localhost') {
    throw new Error(`${VARIABLE_URL_PUBLICA} tiene que ser https salvo en localhost.`);
  }
  return urlPublica.origin;
}

/** Correo del acceso: el mismo proveedor y remitente que la aprobación por correo. */
export function correoDesdeEntorno(
  entorno: Record<string, string | undefined>,
): ConfiguracionCorreoAcceso {
  const proveedor = texto(entorno, 'AIW_CORREO_PROVEEDOR', 'memoria');
  if (!PROVEEDORES_CORREO.includes(proveedor as ProveedorCorreo)) {
    throw new Error(`AIW_CORREO_PROVEEDOR tiene que ser ${PROVEEDORES_CORREO.join(' o ')}.`);
  }
  return {
    proveedor: proveedor as ProveedorCorreo,
    remitente: texto(entorno, 'AIW_CORREO_REMITENTE', 'agentes@aiworkforce.local'),
    smtp: {
      host: texto(entorno, 'AIW_CORREO_SMTP_HOST', 'localhost'),
      puerto: positivo(entorno, 'AIW_CORREO_SMTP_PUERTO', 1025),
      seguro: ENCENDIDO.has((entorno['AIW_CORREO_SMTP_TLS'] ?? '').trim().toLowerCase()),
      usuario: texto(entorno, 'AIW_CORREO_SMTP_USUARIO', ''),
      contrasena: new Secreto(
        entorno['AIW_CORREO_SMTP_CONTRASENA'] ?? '',
        'AIW_CORREO_SMTP_CONTRASENA',
      ),
    },
  };
}
