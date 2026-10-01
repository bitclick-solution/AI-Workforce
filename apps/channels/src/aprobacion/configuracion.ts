/**
 * Configuración de la aprobación por correo, leída del entorno.
 *
 * Todo lo que cambia entre entornos es dato: el remitente, el proveedor de correo,
 * la dirección de Temporal y el nombre de la señal. Nada de eso se despliega.
 *
 * La bandera `AIW_APROBACION_CORREO` manda: apagada, no se exige clave, no se abre
 * puerto y no se envía correo. Esa es la bandera de funcionalidad que la definición
 * de hecho pide hasta la demo, y además es lo que deja que la imagen del contenedor
 * siga arrancando y terminando en la integración continua.
 */
import { Secreto } from '../secreto.js';

import { exigirClaveDeFirma } from './firma.js';

export const PROVEEDORES_CORREO = ['memoria', 'smtp'] as const;
export type ProveedorCorreo = (typeof PROVEEDORES_CORREO)[number];

export const PROVEEDORES_SENAL = ['memoria', 'temporal'] as const;
export type ProveedorSenal = (typeof PROVEEDORES_SENAL)[number];

export interface ConfiguracionSmtp {
  host: string;
  puerto: number;
  /** TLS desde el primer byte. Con Mailpit en local, `false`. */
  seguro: boolean;
  usuario: string;
  contrasena: Secreto;
}

export interface ConfiguracionCorreo {
  proveedor: ProveedorCorreo;
  remitente: string;
  smtp: ConfiguracionSmtp;
  /** Intentos de envío, contando el primero. */
  intentos: number;
  retardoMs: number;
}

export interface ConfiguracionSenal {
  proveedor: ProveedorSenal;
  /** Nombre con el que el flujo espera la señal. Lo fija la prueba técnica. */
  nombre: string;
  direccionTemporal: string;
  espacioTemporal: string;
  intentos: number;
  retardoMs: number;
}

export interface ConfiguracionAprobacion {
  activa: boolean;
  /** Vacía cuando la bandera está apagada: sin bandera no se firma nada. */
  claveDeFirma: Secreto;
  urlPublica: string;
  puerto: number;
  /** Validez del enlace cuando la aprobación no trae `vence_en`. */
  validezHoras: number;
  correo: ConfiguracionCorreo;
  senal: ConfiguracionSenal;
}

export type Entorno = Record<string, string | undefined>;

const VARIABLE_BANDERA = 'AIW_APROBACION_CORREO';
const VARIABLE_CLAVE = 'AIW_APROBACION_CLAVE_FIRMA';

/** Valores que cuentan como «encendido». Cualquier otro apaga la bandera. */
const ENCENDIDO = new Set(['1', 'true', 'si', 'sí', 'on']);

export function banderaEncendida(entorno: Entorno = process.env): boolean {
  return ENCENDIDO.has((entorno[VARIABLE_BANDERA] ?? '').trim().toLowerCase());
}

export function leerConfiguracion(entorno: Entorno = process.env): ConfiguracionAprobacion {
  const activa = banderaEncendida(entorno);
  const urlPublica = texto(entorno, 'AIW_APROBACION_URL_PUBLICA', 'http://localhost:4010');
  const puerto = numero(entorno, 'AIW_APROBACION_PUERTO', 4010);

  return {
    activa,
    // Con la bandera apagada no se pide clave: el proceso arranca, no abre puerto y
    // termina. Encendida, falta de clave es un fallo al arrancar y no una sorpresa
    // en el primer correo.
    claveDeFirma: activa
      ? exigirClaveDeFirma(entorno[VARIABLE_CLAVE], VARIABLE_CLAVE)
      : new Secreto('', VARIABLE_CLAVE),
    urlPublica,
    puerto,
    validezHoras: numero(entorno, 'AIW_APROBACION_VALIDEZ_HORAS', 72),
    correo: {
      proveedor: opcion(
        entorno,
        'AIW_CORREO_PROVEEDOR',
        PROVEEDORES_CORREO,
        'memoria',
      ) as ProveedorCorreo,
      remitente: texto(entorno, 'AIW_CORREO_REMITENTE', 'agentes@aiworkforce.local'),
      smtp: {
        host: texto(entorno, 'AIW_CORREO_SMTP_HOST', 'localhost'),
        puerto: numero(entorno, 'AIW_CORREO_SMTP_PUERTO', 1025),
        seguro: ENCENDIDO.has((entorno['AIW_CORREO_SMTP_TLS'] ?? '').trim().toLowerCase()),
        usuario: texto(entorno, 'AIW_CORREO_SMTP_USUARIO', ''),
        contrasena: new Secreto(
          entorno['AIW_CORREO_SMTP_CONTRASENA'] ?? '',
          'AIW_CORREO_SMTP_CONTRASENA',
        ),
      },
      intentos: numero(entorno, 'AIW_CORREO_INTENTOS', 3),
      retardoMs: numero(entorno, 'AIW_CORREO_RETARDO_MS', 500),
    },
    senal: {
      proveedor: opcion(
        entorno,
        'AIW_SENAL_PROVEEDOR',
        PROVEEDORES_SENAL,
        'memoria',
      ) as ProveedorSenal,
      nombre: texto(entorno, 'AIW_SENAL_NOMBRE', 'decisionDeAprobacion'),
      direccionTemporal: texto(entorno, 'AIW_TEMPORAL_DIRECCION', 'localhost:7233'),
      espacioTemporal: texto(entorno, 'AIW_TEMPORAL_ESPACIO', 'default'),
      intentos: numero(entorno, 'AIW_SENAL_INTENTOS', 3),
      retardoMs: numero(entorno, 'AIW_SENAL_RETARDO_MS', 500),
    },
  };
}

/**
 * Tenants cuyas aprobaciones nuevas se mandan solas por correo, leyendo la salida
 * transaccional de eventos (seguimiento 2-10). Vacía por defecto: sin ella, el
 * comportamiento es el de antes de este seguimiento, ninguna aprobación se envía
 * sola. Leer `evento_salida` de todos los tenants a la vez pediría un rol con
 * privilegio que hoy no existe; esta lista explícita es la frontera mientras tanto.
 */
export function leerTenantsVigilados(entorno: Entorno = process.env): string[] {
  return (entorno['AIW_APROBACION_TENANTS'] ?? '')
    .split(',')
    .map((valor) => valor.trim())
    .filter((valor) => valor.length > 0);
}

function texto(entorno: Entorno, variable: string, porDefecto: string): string {
  const valor = (entorno[variable] ?? '').trim();
  return valor.length > 0 ? valor : porDefecto;
}

function numero(entorno: Entorno, variable: string, porDefecto: number): number {
  const crudo = (entorno[variable] ?? '').trim();
  if (crudo.length === 0) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new Error(`${variable} tiene que ser un número mayor que cero, y vale «${crudo}».`);
  }
  return valor;
}

function opcion(
  entorno: Entorno,
  variable: string,
  admitidos: readonly string[],
  porDefecto: string,
): string {
  const valor = texto(entorno, variable, porDefecto);
  if (!admitidos.includes(valor)) {
    throw new Error(`${variable} solo admite ${admitidos.join(' o ')}, y vale «${valor}».`);
  }
  return valor;
}
