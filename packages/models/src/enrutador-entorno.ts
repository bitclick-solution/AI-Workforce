/**
 * El enrutador de un proceso, construido desde su entorno (ADR-023).
 *
 * Es lo que llaman el trabajador y cualquier otro proceso que arranque tareas: lee
 * `AIW_PROVEEDOR_MODELOS` y `AIW_PROVEEDOR_MODELOS_RESPALDO`, registra ese proveedor
 * con las fábricas y los clientes de Modelos v1 (`proveedor.ts`, `clientes.ts`,
 * `anthropic.ts`) y lo elige. Cambiar de proveedor es cambiar la variable.
 *
 * Tres reglas, todas para que ningún proceso cobre —o deje de cobrar— por un modelo
 * que nadie eligió:
 *
 * - El proveedor de prueba solo entra con `AIW_PROVEEDOR_MODELOS=prueba`, escrito.
 * - Sin variable, el proveedor es Bedrock UE (ADR-023), y si le faltan las
 *   credenciales el arranque falla nombrando lo que falta. No cae a prueba.
 * - El respaldo es perezoso: no hace falta tener sus credenciales para arrancar, se
 *   construye la primera vez que el principal falla.
 */
import { plataformaDelProveedor, PROVEEDORES_MODELO, type ProveedorModelos } from './proveedor.js';
import { crearAdaptadorAnthropic } from './adaptadores/anthropic.js';
import type { ClienteDeMensajes } from './adaptadores/cliente-mensajes.js';
import type { Entorno } from './adaptadores/clientes.js';
import { clienteDelProveedorDesdeEntorno } from './proveedor.js';
import { Enrutador } from './enrutado.js';
import { enrutadorDeGuiones } from './guiones/index.js';
import { PROVEEDOR_PRUEBA } from './proveedor-prueba.js';

export const VARIABLE_PROVEEDOR = 'AIW_PROVEEDOR_MODELOS';
export const VARIABLE_PROVEEDOR_RESPALDO = 'AIW_PROVEEDOR_MODELOS_RESPALDO';

/** Valores que admite `AIW_PROVEEDOR_MODELOS`: los dos reales y el de prueba, que hay que escribir. */
export const PROVEEDORES_ELEGIBLES = [...PROVEEDORES_MODELO, PROVEEDOR_PRUEBA] as const;

export interface OpcionesEnrutadorDesdeEntorno {
  /**
   * Clientes ya construidos, por proveedor. Solo para pruebas: con uno dado, no se
   * exigen credenciales de ese proveedor y no se construye el cliente real.
   */
  clientes?: Partial<Record<ProveedorModelos, ClienteDeMensajes>> | undefined;
}

/**
 * Variables que dicen de dónde salen las credenciales de AWS, sin leerlas. Con
 * alguna basta; el SDK de Bedrock resuelve el resto con su cadena habitual.
 */
const SEÑALES_DE_CREDENCIALES_AWS = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_PROFILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
] as const;

/** Escape para máquinas con credenciales por rol de instancia (IMDS), que no dejan ninguna variable. */
export const VARIABLE_CREDENCIALES_EXTERNAS = 'AIW_BEDROCK_CREDENCIALES_EXTERNAS';

function tiene(entorno: Entorno, clave: string): boolean {
  return (entorno[clave] ?? '').trim() !== '';
}

/**
 * Falla, nombrando lo que falta, si el entorno no dice de dónde salen las
 * credenciales de Bedrock. Solo mira si las variables existen: nunca las lee ni las
 * escribe en un mensaje.
 */
export function comprobarCredencialesDeBedrock(entorno: Entorno): void {
  if (tiene(entorno, 'AWS_ACCESS_KEY_ID') && tiene(entorno, 'AWS_SECRET_ACCESS_KEY')) return;
  if (SEÑALES_DE_CREDENCIALES_AWS.some((clave) => tiene(entorno, clave))) return;
  if (entorno[VARIABLE_CREDENCIALES_EXTERNAS] === '1') return;
  throw new Error(
    `${VARIABLE_PROVEEDOR}=bedrock-ue necesita credenciales de AWS y no hay ninguna en el entorno: ` +
      'falta AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY (usuario IAM aiw-dev en local), ' +
      'o AWS_PROFILE, o AWS_WEB_IDENTITY_TOKEN_FILE. ' +
      `Con credenciales por rol de instancia, pon ${VARIABLE_CREDENCIALES_EXTERNAS}=1. ` +
      `Para no usar un modelo real, elige ${VARIABLE_PROVEEDOR}=${PROVEEDOR_PRUEBA}.`,
  );
}

function valorDe(entorno: Entorno, clave: string): string | undefined {
  const valor = entorno[clave]?.trim();
  return valor === undefined || valor === '' ? undefined : valor;
}

function proveedorReal(valor: string, clave: string): ProveedorModelos {
  if (!(PROVEEDORES_MODELO as readonly string[]).includes(valor)) {
    throw new Error(
      `${clave}="${valor}" no es un proveedor de modelos válido. ` +
        `Valores admitidos: ${PROVEEDORES_ELEGIBLES.join(', ')}.`,
    );
  }
  return valor as ProveedorModelos;
}

/**
 * Enrutador del proceso según su entorno.
 *
 * - `AIW_PROVEEDOR_MODELOS=prueba`: el proveedor determinista, sin claves.
 * - `bedrock-ue` (por defecto) o `vertex-ue`: el real, con su respaldo de
 *   `AIW_PROVEEDOR_MODELOS_RESPALDO` (por defecto el otro real, `vertex-ue`).
 */
export function enrutadorDesdeEntorno(
  entorno: Entorno = process.env,
  opciones: OpcionesEnrutadorDesdeEntorno = {},
): Enrutador {
  const elegido = valorDe(entorno, VARIABLE_PROVEEDOR);
  if (elegido === PROVEEDOR_PRUEBA) return enrutadorDeGuiones();

  const principal = proveedorReal(elegido ?? 'bedrock-ue', VARIABLE_PROVEEDOR);
  const respaldoElegido = valorDe(entorno, VARIABLE_PROVEEDOR_RESPALDO) ?? 'vertex-ue';
  const respaldo = proveedorReal(respaldoElegido, VARIABLE_PROVEEDOR_RESPALDO);

  const clientes = new Map<ProveedorModelos, ClienteDeMensajes>();
  const cliente = (proveedor: ProveedorModelos): ClienteDeMensajes => {
    const existente = clientes.get(proveedor) ?? opciones.clientes?.[proveedor];
    if (existente) return existente;
    const nuevo = clienteDelProveedorDesdeEntorno(proveedor, entorno);
    clientes.set(proveedor, nuevo);
    return nuevo;
  };

  // El principal se construye ya: si le falta algo, el proceso no arranca.
  if (principal === 'bedrock-ue' && !opciones.clientes?.[principal]) {
    comprobarCredencialesDeBedrock(entorno);
  }
  cliente(principal);

  const enrutador = new Enrutador();
  for (const proveedor of new Set<ProveedorModelos>([principal, respaldo])) {
    enrutador.registrarPuerto(proveedor, (papel) =>
      crearAdaptadorAnthropic(cliente(proveedor), {
        papel,
        plataforma: plataformaDelProveedor(proveedor),
        // El esfuerzo por clase de paso es el de ADR-018; la versión de puesto que lo
        // afine llegará como dato, no como código.
        configuracion: { esfuerzoPorClasePaso: {} },
      }),
    );
  }
  return enrutador.elegir({ principal, ...(respaldo === principal ? {} : { respaldo }) });
}
