/**
 * Bandera de la interfaz de Sala v1 (ADR-022). Mismo patrón que `AIW_SALA_V0` y
 * `AIW_PANEL_CONTADOR`: `'1'` o `'true'` la activan; cualquier otro valor, no.
 * Con ella, `/panel/sala` sirve la v1; sin ella, la v0 si su bandera está puesta.
 */
export const BANDERA_SALA_V1 = 'AIW_SALA_V1';

export function salaV1Activa(entorno: Record<string, string | undefined>): boolean {
  const valor = entorno[BANDERA_SALA_V1]?.trim();
  return valor === '1' || valor === 'true';
}
