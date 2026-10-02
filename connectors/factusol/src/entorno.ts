/**
 * Credenciales y configuración del conector.
 *
 * Llegan solo por variables de entorno que el gateway inyecta al lanzar el
 * proceso. Nunca en el código, nunca en el prompt, nunca en los registros y
 * nunca como argumento de herramienta. El token es el del agente: si trae el
 * scope `confirmar`, el conector se niega a arrancar.
 */
import { ErrorConector } from './errores.js';

export interface ConfiguracionFactusol {
  /** Extremo SSE de Factusol MCP, sin credenciales dentro. */
  readonly extremoMcp: string;
  /** JWT HS256 del agente. Vive en memoria y no sale del proceso. */
  readonly token: string;
  readonly tenantId: string;
  /**
   * JWT con el scope `confirmar` (ADR-031). Solo existe en el proceso que el gateway
   * lanza para ejecutar una escritura ya aprobada; en el resto de procesos es `undefined`.
   * Lo usa únicamente `confirmar_operacion`, nunca las lecturas ni el resto del agente.
   */
  readonly tokenConfirmar?: string;
  /** Directorio donde se guarda el borrador pendiente de cada clave de idempotencia. */
  readonly directorioDeEstado?: string;
}

export const VARIABLES = ['FACTUSOL_MCP_URL', 'FACTUSOL_MCP_TOKEN', 'FACTUSOL_TENANT_ID'] as const;

export const LONGITUD_MINIMA_SECRETO = 8;

export const SCOPE_PROHIBIDO = 'confirmar';

/** Segunda credencial, con nombre distinto: la entrega el gateway solo a una escritura aprobada. */
export const VARIABLE_TOKEN_CONFIRMAR = 'FACTUSOL_MCP_TOKEN_CONFIRMAR';

export const MOTIVO_SALTO =
  `Sin ${VARIABLES.join(', ')}: estas pruebas necesitan la instancia de pruebas de Factusol MCP. ` +
  'Defínelas en tu entorno para ejecutarlas; en la CI corren sobre las grabaciones de src/grabaciones.';

type Entorno = Record<string, string | undefined>;

export function hayCredenciales(entorno: Entorno = process.env): boolean {
  return VARIABLES.every((nombre) => (entorno[nombre] ?? '').trim() !== '');
}

/**
 * Scopes de un JWT, decodificado sin verificarlo: el conector no tiene el
 * secreto y no lo necesita, solo se niega a llevar un token que confirma.
 */
export function scopesDelToken(token: string, variable = 'FACTUSOL_MCP_TOKEN'): string[] {
  const partes = token.split('.');
  if (partes.length !== 3) {
    throw new ErrorConector('invalido', `${variable} no es un JWT de tres partes.`);
  }
  let carga: unknown;
  try {
    carga = JSON.parse(Buffer.from(partes[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    throw new ErrorConector('invalido', `${variable} no lleva una carga JWT legible.`);
  }
  if (typeof carga !== 'object' || carga === null || Array.isArray(carga)) {
    throw new ErrorConector('invalido', `${variable} no lleva una carga JWT legible.`);
  }
  const objeto = carga as Record<string, unknown>;
  const scopes: string[] = [];
  for (const clave of ['scope', 'scopes', 'scp'] as const) {
    const valor = objeto[clave];
    if (typeof valor === 'string') scopes.push(...valor.split(/[\s,]+/));
    else if (Array.isArray(valor)) {
      scopes.push(...valor.filter((v): v is string => typeof v === 'string'));
    }
  }
  return scopes.filter((scope) => scope !== '');
}

/** Lee la configuración o falla rápido diciendo qué falta. Nunca nombra un valor. */
export function leerConfiguracion(entorno: Entorno = process.env): ConfiguracionFactusol {
  const ausentes = VARIABLES.filter((nombre) => (entorno[nombre] ?? '').trim() === '');
  if (ausentes.length > 0) {
    throw new ErrorConector(
      'invalido',
      `Faltan variables de entorno del conector de Factusol: ${ausentes.join(', ')}. Las inyecta el gateway MCP al lanzar el proceso.`,
    );
  }
  const extremoMcp = (entorno['FACTUSOL_MCP_URL'] ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\/[^@/]*@/i.test(extremoMcp)) {
    throw new ErrorConector(
      'invalido',
      'FACTUSOL_MCP_URL no puede llevar usuario ni contraseña dentro: el token va en FACTUSOL_MCP_TOKEN.',
    );
  }
  const token = (entorno['FACTUSOL_MCP_TOKEN'] ?? '').trim();
  if (token.length < LONGITUD_MINIMA_SECRETO) {
    throw new ErrorConector(
      'invalido',
      `FACTUSOL_MCP_TOKEN es demasiado corto: no se redactaría un valor de menos de ${String(LONGITUD_MINIMA_SECRETO)} caracteres.`,
    );
  }
  if (scopesDelToken(token).includes(SCOPE_PROHIBIDO)) {
    throw new ErrorConector(
      'no_autorizado',
      `FACTUSOL_MCP_TOKEN lleva el scope «${SCOPE_PROHIBIDO}»: ese token no va nunca con las herramientas del agente. El conector no arranca.`,
    );
  }
  const tokenConfirmar = (entorno[VARIABLE_TOKEN_CONFIRMAR] ?? '').trim();
  if (tokenConfirmar !== '') {
    if (tokenConfirmar === token) {
      throw new ErrorConector(
        'invalido',
        `${VARIABLE_TOKEN_CONFIRMAR} no puede ser el token del agente: son dos credenciales distintas.`,
      );
    }
    if (tokenConfirmar.length < LONGITUD_MINIMA_SECRETO) {
      throw new ErrorConector(
        'invalido',
        `${VARIABLE_TOKEN_CONFIRMAR} es demasiado corto: no se redactaría un valor de menos de ${String(LONGITUD_MINIMA_SECRETO)} caracteres.`,
      );
    }
    if (!scopesDelToken(tokenConfirmar, VARIABLE_TOKEN_CONFIRMAR).includes(SCOPE_PROHIBIDO)) {
      throw new ErrorConector(
        'invalido',
        `${VARIABLE_TOKEN_CONFIRMAR} no lleva el scope «${SCOPE_PROHIBIDO}»: con él no se podría confirmar nada.`,
      );
    }
  }
  const directorio = (entorno['FACTUSOL_ESTADO_DIR'] ?? '').trim();
  return {
    extremoMcp,
    token,
    tenantId: (entorno['FACTUSOL_TENANT_ID'] ?? '').trim(),
    ...(tokenConfirmar === '' ? {} : { tokenConfirmar }),
    ...(directorio === '' ? {} : { directorioDeEstado: directorio }),
  };
}

export const MARCA_OCULTA = '«oculto»';

/** Tapa los secretos de un texto antes de que salga del proceso. */
export function redactar(texto: string, secretos: readonly (string | undefined)[]): string {
  let resultado = texto;
  for (const secreto of secretos) {
    if (secreto === undefined) continue;
    const limpio = secreto.trim();
    if (limpio.length < LONGITUD_MINIMA_SECRETO) continue;
    resultado = resultado.split(limpio).join(MARCA_OCULTA);
  }
  return resultado;
}

/** Registro del conector: `stderr`, porque `stdout` es el transporte MCP, y siempre redactado. */
export function registrar(mensaje: string, secretos: readonly (string | undefined)[] = []): void {
  console.error(`[conector-factusol] ${redactar(mensaje, secretos)}`);
}
