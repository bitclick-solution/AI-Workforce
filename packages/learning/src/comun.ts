/**
 * Piezas compartidas entre `operaciones.ts` (señal, lección, promoción, reversión)
 * y `habilidades.ts` (siembra y activación de habilidades). Viven aparte para que
 * los dos módulos se puedan importar uno a otro sin depender en círculo.
 */
import type postgres from 'postgres';

/**
 * Nombres de acción del libro para el aprendizaje. Se añaden, no se renombran: una
 * consulta de auditoría escrita hoy tiene que seguir sirviendo dentro de seis años.
 */
export const ACCIONES_APRENDIZAJE = {
  senalRegistrada: 'aprendizaje.senal.registrada',
  leccionPropuesta: 'aprendizaje.leccion.propuesta',
  leccionPromocionada: 'aprendizaje.leccion.promocionada',
  promocionBloqueada: 'aprendizaje.promocion.bloqueada',
  versionRevertida: 'aprendizaje.version.revertida',
  /** Habilidades en el bucle: siembra del catálogo en la fila `habilidad`. */
  habilidadSembrada: 'aprendizaje.habilidad.sembrada',
} as const;

/** Origen de la señal que nace de una edición del borrador antes de aprobar. */
export const ORIGEN_EDICION = 'aprobacion.editada';

/** Clave de la memoria viva de una lección: una fila por lección y puesto. */
export function claveDeMemoria(leccionId: string): string {
  return `leccion:${leccionId}`;
}

export type CodigoErrorAprendizaje =
  | 'no_encontrada'
  | 'no_es_edicion'
  | 'sin_cambios'
  | 'sin_persona'
  | 'ya_promocionada'
  | 'version_ajena'
  | 'ya_activa';

/**
 * Error esperado del aprendizaje. El flujo durable no lo reintenta: repetir una
 * promoción de una lección ya promocionada no la va a promocionar mejor.
 */
export class ErrorDeAprendizaje extends Error {
  readonly codigo: CodigoErrorAprendizaje;

  constructor(codigo: CodigoErrorAprendizaje, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeAprendizaje';
    this.codigo = codigo;
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function exigirUuid(valor: string, que: string): void {
  if (!UUID.test(valor))
    throw new ErrorDeAprendizaje('no_encontrada', `${que} no es un UUID: ${valor}`);
}

/** Código de PostgreSQL para la violación de una restricción de unicidad. */
const UNICIDAD_VIOLADA = '23505';

/**
 * El índice único `promocion_tenant_leccion_key` es la red de seguridad de la base:
 * la comprobación previa de `promocionarLeccion` evita la versión de puesto de sobra
 * en el camino normal, pero quien inserte en `promocion` sin pasar por ahí —o gane la
 * carrera contra ella— choca aquí igual.
 */
export function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNICIDAD_VIOLADA
  );
}

/**
 * Serializa dentro de la transacción las operaciones sobre la misma clave. Es lo que
 * impide que dos reintentos simultáneos inserten dos señales para una edición o dos
 * versiones con el mismo número para un puesto.
 */
export async function bloquear(tx: postgres.TransactionSql, clave: string): Promise<void> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${clave}, 1))`;
}

export function json(valor: unknown): string {
  return JSON.stringify(valor);
}
