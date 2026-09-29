/**
 * Entradas del libro de auditoría del acceso al panel.
 *
 * Se escriben con `anotar` de `@aiw/ledger`, el único punto de escritura del
 * libro, dentro de `conTenant` con el tenant de la persona: cada inicio, cierre y
 * caducidad de sesión queda en la cadena de su organización y suma al contador.
 *
 * Los nombres de acción viven aquí y solo aquí: una consulta de auditoría dentro de
 * seis años filtra por este texto. Se añaden, no se renombran.
 *
 * Reintentos: una escritura del libro puede fallar por un corte breve de la base.
 * Se reintenta pocas veces y con espera corta, porque quien espera es una persona
 * delante de la pantalla de acceso.
 */
import { conTenant } from '@aiw/db';
import { anotar, type EntradaNueva } from '@aiw/ledger';
import type postgres from 'postgres';

export const ACCIONES_ACCESO = {
  propietarioInvitado: 'acceso.propietario.invitado',
  enlaceEnviado: 'acceso.enlace.enviado',
  sesionIniciada: 'acceso.sesion.iniciada',
  sesionCerrada: 'acceso.sesion.cerrada',
  sesionCaducada: 'acceso.sesion.caducada',
} as const;

export type AccionAcceso = (typeof ACCIONES_ACCESO)[keyof typeof ACCIONES_ACCESO];

/** Cómo se abrió la sesión. Va en `herramienta`: es el mecanismo, no el dato. */
export const METODOS_ACCESO = {
  enlace: 'better-auth:magic-link',
  passkey: 'better-auth:passkey',
  desconocido: 'better-auth',
} as const;

export interface AnotacionDeAcceso {
  accion: AccionAcceso;
  actorTipo: EntradaNueva['actorTipo'];
  actorId?: string | null;
  herramienta?: string;
  datos: { tipo: string; id: string }[];
}

/** Escribe una entrada del libro. Lo que la API usa para anotar el acceso. */
export type AnotadorDeAcceso = (tenantId: string, anotacion: AnotacionDeAcceso) => Promise<void>;

export interface OpcionesDeReintento {
  intentos: number;
  esperaMs: number;
}

const REINTENTO_POR_DEFECTO: OpcionesDeReintento = { intentos: 3, esperaMs: 100 };

/** Anotador real: `conTenant` con el rol de aplicación y `anotar`, con reintentos. */
export function anotadorConBaseDeDatos(
  clienteApp: postgres.Sql,
  reintento: OpcionesDeReintento = REINTENTO_POR_DEFECTO,
): AnotadorDeAcceso {
  return async (tenantId, anotacion) => {
    let ultimoError: unknown;
    for (let intento = 1; intento <= reintento.intentos; intento++) {
      try {
        await conTenant(clienteApp, tenantId, async (tx) => {
          await anotar(tx, tenantId, {
            actorTipo: anotacion.actorTipo,
            actorId: anotacion.actorId ?? null,
            accion: anotacion.accion,
            herramienta: anotacion.herramienta ?? null,
            datosReferenciados: anotacion.datos,
            resultado: 'exito',
          });
        });
        return;
      } catch (error) {
        ultimoError = error;
        if (intento < reintento.intentos) {
          await new Promise((resolver) => setTimeout(resolver, reintento.esperaMs * intento));
        }
      }
    }
    throw ultimoError instanceof Error
      ? ultimoError
      : new Error('No se pudo anotar el acceso en el libro.');
  };
}
