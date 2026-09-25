/**
 * Esfuerzo por clase de paso (ADR-018).
 *
 * La versión de puesto puede fijar un esfuerzo por clase; si no lo fija, se aplica
 * el nivel por defecto de esta tabla. El máximo queda reservado a evals de
 * certificación: nada lo aplica por defecto, y una petición de certificación que no
 * lo pida explícitamente sigue en alto, no en máximo.
 */
import type { ClasePaso, NivelEsfuerzo, esquemas } from '@aiw/domain';

const ESFUERZO_POR_DEFECTO: Record<ClasePaso, NivelEsfuerzo> = {
  moderador_sala: 'low',
  enrutado: 'low',
  resumen: 'low',
  rutina: 'low',
  negocio: 'medium',
  razonamiento_financiero: 'high',
  conciliacion: 'high',
  decision_escritura: 'high',
  certificacion: 'high',
};

/**
 * Resuelve el esfuerzo de una clase de paso: primero lo que fija la configuración
 * de modelo de la versión de puesto, y si no lo fija, el nivel por defecto de la
 * clase.
 */
export function esfuerzoParaClase(
  configuracion: Pick<esquemas.ConfiguracionModeloPuesto, 'esfuerzoPorClasePaso'>,
  clase: ClasePaso,
): NivelEsfuerzo {
  return configuracion.esfuerzoPorClasePaso[clase] ?? ESFUERZO_POR_DEFECTO[clase];
}
