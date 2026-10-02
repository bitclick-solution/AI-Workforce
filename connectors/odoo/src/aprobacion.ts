/** La aprobación de una escritura del MCP dinámico. */
import { ErrorConector } from './errores.js';

/**
 * `preview_write` y `validate_write` del MCP dinámico real (v1.3.1) declaran su
 * tipo de vuelta como `Dict[str, Any]` genérico, no un modelo con campos propios
 * como `search_records`: FastMCP envuelve esa salida entera bajo `result`, igual
 * que hace con las de escritura. Sin probar también esa envolvente, `validate_write`
 * nunca encuentra la aprobación anidada en `result.approval.token` — el gemelo en
 * escrituras del bug que el PR #62 arregló en lecturas (`leerRegistros`).
 */
export function extraerAprobacion(carga: unknown): Record<string, unknown> {
  if (typeof carga === 'object' && carga !== null) {
    const objeto = carga as Record<string, unknown>;
    for (const clave of ['approval_id', 'approval_token', 'token', 'id'] as const) {
      const valor = objeto[clave];
      if (typeof valor === 'string' || typeof valor === 'number') return { approval_id: valor };
    }
    const anidada =
      objeto['approval'] ?? objeto['approval_status'] ?? objeto['data'] ?? objeto['result'];
    if (anidada !== undefined && anidada !== objeto) return extraerAprobacion(anidada);
  }
  throw new ErrorConector(
    'invalido',
    'El MCP dinámico no devolvió aprobación para la escritura: la actividad no se crea sin ella.',
  );
}
