/** La aprobación de una escritura del MCP dinámico. */
import { ErrorConector } from './errores.js';

/**
 * `preview_write` y `validate_write` del MCP dinámico real (v1.3.1) declaran su
 * tipo de vuelta como `Dict[str, Any]` genérico, no un modelo con campos propios
 * como `search_records`: FastMCP envuelve esa salida entera bajo `result`, igual
 * que hace con las de escritura. Sin probar también esa envolvente, `validate_write`
 * nunca encuentra la aprobación anidada en `result.approval` — el gemelo en
 * escrituras del bug que el PR #62 arregló en lecturas (`leerRegistros`).
 *
 * El esquema vivo de `execute_approved_write` (v1.3.1) exige el campo
 * `approval` obligatorio con el objeto entero que devolvió `validate_write`
 * (con su `token` dentro, entre otros campos) — no un `approval_id` ni un
 * token suelto, que era la forma supuesta de la grabación antigua y Pydantic
 * rechazaría con «field required: approval». Mismo criterio que el PR #81,
 * contrastado por el Probador con el `tools/list` de la imagen viva (2-10).
 */
export function extraerAprobacion(carga: unknown): Record<string, unknown> {
  if (typeof carga === 'object' && carga !== null) {
    const objeto = carga as Record<string, unknown>;
    const aprobacion = objeto['approval'];
    if (typeof aprobacion === 'object' && aprobacion !== null && !Array.isArray(aprobacion)) {
      return { approval: aprobacion };
    }
    if ('result' in objeto && objeto['result'] !== objeto)
      return extraerAprobacion(objeto['result']);
  }
  throw new ErrorConector(
    'invalido',
    'El MCP dinámico no devolvió aprobación para la escritura: la actividad no se crea sin ella.',
  );
}
