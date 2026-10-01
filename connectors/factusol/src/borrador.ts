/**
 * Lectura de la respuesta de `draft_modificar_cliente`.
 *
 * Es JSON estructurado, capturado por el Probador contra la instancia el 1-10 (Factusol MCP
 * 3.4.7): `borrador.draft_id` y `borrador.cuerpo.campos`, una lista de
 * `{ nombre, valor_actual, valor_nuevo, cambia }`. Cualquier otra forma es `invalido`.
 */
import { ErrorConector } from './errores.js';

export interface BorradorLeido {
  readonly draftId: string;
  /** Lo que había en `observaciones` del cliente antes del borrador. */
  readonly observacionesActuales: string;
}

function fallo(mensaje: string): never {
  throw new ErrorConector(
    'invalido',
    `El borrador de Factusol MCP no encaja en el contrato: ${mensaje}`,
  );
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function cuerpoDe(estructurado: unknown): Record<string, unknown> {
  if (!esObjeto(estructurado)) return fallo('la respuesta no es JSON estructurado');
  const borrador = estructurado['borrador'];
  if (!esObjeto(borrador)) return fallo('no trae «borrador»');
  return borrador;
}

/** Identificador del borrador aunque su diff no se pueda leer, para poder cancelarlo. */
export function leerIdDeBorrador(estructurado: unknown): string | undefined {
  try {
    const id = cuerpoDe(estructurado)['draft_id'];
    return typeof id === 'string' && id.trim() !== '' ? id : undefined;
  } catch {
    return undefined;
  }
}

export interface CambioDeCampo {
  readonly actual: string;
  readonly nuevo: string;
  readonly cambia: boolean;
}

function comoTexto(valor: unknown): string | undefined {
  if (valor === null) return '';
  return typeof valor === 'string' ? valor : undefined;
}

/**
 * Cambios del borrador por campo (nombre en minúsculas), «valor actual → nuevo». Sin
 * `cuerpo.campos` el mapa viene vacío y quien confirma no confirma.
 */
export function leerCambios(estructurado: unknown): Map<string, CambioDeCampo> {
  const cambios = new Map<string, CambioDeCampo>();
  const cuerpo = cuerpoDe(estructurado)['cuerpo'];
  if (!esObjeto(cuerpo)) return cambios;
  const campos = cuerpo['campos'];
  if (!Array.isArray(campos)) return cambios;
  for (const campo of campos) {
    if (!esObjeto(campo)) return fallo('un campo del borrador no es un objeto');
    const nombre = campo['nombre'];
    const actual = comoTexto(campo['valor_actual']);
    const nuevo = comoTexto(campo['valor_nuevo']);
    if (
      typeof nombre !== 'string' ||
      nombre.trim() === '' ||
      actual === undefined ||
      nuevo === undefined
    ) {
      return fallo('un campo del borrador no trae «nombre», «valor_actual» y «valor_nuevo»');
    }
    cambios.set(nombre.trim().toLowerCase(), { actual, nuevo, cambia: campo['cambia'] === true });
  }
  return cambios;
}

export function leerBorrador(estructurado: unknown): BorradorLeido {
  const draftId = cuerpoDe(estructurado)['draft_id'];
  if (typeof draftId !== 'string' || draftId.trim() === '') return fallo('no trae «draft_id»');
  const observaciones = leerCambios(estructurado).get('observaciones');
  if (observaciones === undefined) return fallo('el diff no trae el campo «Observaciones»');
  return { draftId, observacionesActuales: observaciones.actual };
}
