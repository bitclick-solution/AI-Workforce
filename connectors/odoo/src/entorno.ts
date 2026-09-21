/**
 * Credenciales y configuración del conector.
 *
 * Llegan solo por variables de entorno que el gateway inyecta al lanzar el
 * proceso. Nunca en el código, nunca en el prompt, nunca en los registros y
 * nunca como argumento de herramienta. El cifrado por tenant y la resolución
 * de `conector.referencia_secreto` son del gateway: aquí llegan ya en claro y
 * solo dentro de este proceso.
 */
import { ErrorConector } from './errores.js';

export interface ConfiguracionOdoo {
  /** URL de la instancia de Odoo, sin credenciales dentro. */
  readonly url: string;
  /** Nombre de la base de datos de Odoo. */
  readonly base: string;
  readonly usuario: string;
  /** Clave de API. Vive en memoria y no sale del proceso. */
  readonly claveApi: string;
  /** Extremo del MCP dinámico, la imagen aislada que habla con Odoo. */
  readonly extremoMcp: string;
}

export const VARIABLES = ['ODOO_URL', 'ODOO_BASE', 'ODOO_USUARIO', 'ODOO_CLAVE_API'] as const;

export const EXTREMO_MCP_POR_DEFECTO = 'http://odoo-mcp:8000/mcp';

export const MOTIVO_SALTO =
  `Sin ${VARIABLES.join(', ')}: estas pruebas necesitan la instancia de pruebas de Odoo y el ` +
  'MCP dinámico. Defínelas en tu entorno para ejecutarlas; en la CI corren sobre las grabaciones de src/grabaciones.';

type Entorno = Record<string, string | undefined>;

/** Cierto cuando están las cuatro variables con valor. Las pruebas de contrato lo consultan. */
export function hayCredenciales(entorno: Entorno = process.env): boolean {
  return VARIABLES.every((nombre) => (entorno[nombre] ?? '').trim() !== '');
}

/**
 * Lee la configuración o falla rápido diciendo qué falta.
 *
 * El mensaje nombra las variables que faltan y jamás su valor.
 */
export function leerConfiguracion(entorno: Entorno = process.env): ConfiguracionOdoo {
  const ausentes = VARIABLES.filter((nombre) => (entorno[nombre] ?? '').trim() === '');
  if (ausentes.length > 0) {
    throw new ErrorConector(
      'invalido',
      `Faltan variables de entorno del conector de Odoo: ${ausentes.join(', ')}. Las inyecta el gateway MCP al lanzar el proceso.`,
    );
  }
  const url = (entorno['ODOO_URL'] ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\/[^@]*@/i.test(url)) {
    throw new ErrorConector(
      'invalido',
      'ODOO_URL no puede llevar usuario ni contraseña dentro: las credenciales van en ODOO_USUARIO y ODOO_CLAVE_API.',
    );
  }
  return {
    url,
    base: (entorno['ODOO_BASE'] ?? '').trim(),
    usuario: (entorno['ODOO_USUARIO'] ?? '').trim(),
    claveApi: (entorno['ODOO_CLAVE_API'] ?? '').trim(),
    extremoMcp: (entorno['ODOO_MCP_URL'] ?? '').trim() || EXTREMO_MCP_POR_DEFECTO,
  };
}

/** Lo que sustituye a un secreto cuando se cuela en un texto que sale del proceso. */
export const MARCA_OCULTA = '«oculto»';

/**
 * Tapa los secretos de un texto antes de que salga del proceso.
 *
 * Se aplica a todo mensaje de error y a todo lo que se escribe en el registro.
 * Es la última red: lo primero es no ponerlos ahí.
 */
export function redactar(texto: string, secretos: readonly (string | undefined)[]): string {
  let resultado = texto;
  for (const secreto of secretos) {
    if (secreto === undefined) continue;
    const limpio = secreto.trim();
    // Un valor corto podría ser una palabra común y taparía texto legítimo. Una
    // credencial de Odoo nunca baja de ocho caracteres.
    if (limpio.length < 8) continue;
    resultado = resultado.split(limpio).join(MARCA_OCULTA);
  }
  return resultado;
}

/**
 * Registro del conector.
 *
 * Va a `stderr` porque `stdout` es el transporte MCP, y pasa por `redactar`.
 * No sustituye al libro de auditoría: las entradas las escribe el gateway.
 */
export function registrar(mensaje: string, secretos: readonly (string | undefined)[] = []): void {
  console.error(`[conector-odoo] ${redactar(mensaje, secretos)}`);
}
