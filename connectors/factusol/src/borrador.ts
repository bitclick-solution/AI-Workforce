/**
 * Lectura de la respuesta de `draft_modificar_cliente`.
 *
 * Es JSON estructurado y no Markdown. Del informe del Probador constan `draft_id`,
 * el diff «valor actual → nuevo» por campo y la caducidad de 30 minutos; no consta
 * la forma exacta del diff. Aquí se asume lo mínimo —un objeto `observaciones`
 * con `valor_actual` en algún nivel— y se rechaza con `invalido` todo lo demás.
 * La prueba de contrato contra la instancia local (criterio 6) fija la forma real.
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

function buscarClave(valor: unknown, clave: string, profundidad = 0): unknown {
  if (profundidad > 6 || !esObjeto(valor)) return undefined;
  if (clave in valor) return valor[clave];
  for (const hijo of Object.values(valor)) {
    const hallado = buscarClave(hijo, clave, profundidad + 1);
    if (hallado !== undefined) return hallado;
  }
  return undefined;
}

export function leerBorrador(estructurado: unknown): BorradorLeido {
  if (!esObjeto(estructurado)) return fallo('la respuesta no es JSON estructurado');
  const draftId = buscarClave(estructurado, 'draft_id');
  if (typeof draftId !== 'string' || draftId.trim() === '') return fallo('no trae «draft_id»');
  const observaciones = buscarClave(estructurado, 'observaciones');
  if (!esObjeto(observaciones) || !('valor_actual' in observaciones)) {
    return fallo('el diff no trae «observaciones» con «valor_actual»');
  }
  const actual = observaciones['valor_actual'];
  if (actual !== null && typeof actual !== 'string') {
    return fallo('«valor_actual» de «observaciones» no es texto');
  }
  return { draftId, observacionesActuales: actual ?? '' };
}
