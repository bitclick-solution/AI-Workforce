/**
 * Respaldo ante el rechazo del clasificador (ADR-018).
 *
 * En Bedrock y en Vertex no hay respaldo de servidor: lo decide la política del
 * puesto (`configuracion.modeloRespaldo`) y lo ejecuta el cliente, que aquí es esta
 * función. El intento con el modelo principal cuenta como paso fallido no
 * reintentable con el mismo modelo — no se reintenta el rechazo, se cambia de
 * modelo o se deja fallado.
 */
import type { PapelModelo, esquemas } from '@aiw/domain';

import type { PeticionDeModelo, PuertoDeModelo, RespuestaDeModelo } from './puerto.js';

/**
 * Qué papel de modelo probar como respaldo tras un rechazo, según la política del
 * puesto. `null` cuando no hay resultado que respaldar o el puesto no tiene
 * respaldo configurado, o cuando el respaldo es el mismo papel que ya rechazó: un
 * puesto sin segundo intento real falla como paso no reintentable sin repetir la
 * misma llamada.
 */
export function decidirRespaldo(
  configuracion: Pick<esquemas.ConfiguracionModeloPuesto, 'modelo' | 'modeloRespaldo'>,
  resultado: RespuestaDeModelo,
): PapelModelo | null {
  if (resultado.tipo !== 'rechazo') return null;
  if (!configuracion.modeloRespaldo) return null;
  if (configuracion.modeloRespaldo === configuracion.modelo) return null;
  return configuracion.modeloRespaldo;
}

export interface ResultadoConRespaldo<T = unknown> {
  resultado: RespuestaDeModelo<T>;
  /** El intento rechazado del modelo principal, cuando se usó el respaldo. */
  rechazoPrincipal?: RespuestaDeModelo<T> & { tipo: 'rechazo' };
  /** `true` cuando el resultado final lo sirvió el puerto de respaldo, no el principal. */
  sirvioRespaldo: boolean;
}

/**
 * Completa con el puerto principal y, si rechaza y la política tiene respaldo,
 * repite la petición con el puerto de respaldo. Nunca reintenta el mismo puerto: el
 * rechazo del clasificador es no reintentable (ADR-018).
 */
export async function completarConRespaldo<T = unknown>(
  configuracion: Pick<esquemas.ConfiguracionModeloPuesto, 'modelo' | 'modeloRespaldo'>,
  puertoPrincipal: PuertoDeModelo,
  resolverPuertoDeRespaldo: (papel: PapelModelo) => PuertoDeModelo,
  peticion: PeticionDeModelo<T>,
): Promise<ResultadoConRespaldo<T>> {
  const primero = await puertoPrincipal.completar(peticion);
  const papelDeRespaldo = decidirRespaldo(configuracion, primero);
  if (!papelDeRespaldo || primero.tipo !== 'rechazo') {
    return { resultado: primero, sirvioRespaldo: false };
  }

  const puertoDeRespaldo = resolverPuertoDeRespaldo(papelDeRespaldo);
  const segundo = await puertoDeRespaldo.completar(peticion);
  return { resultado: segundo, rechazoPrincipal: primero, sirvioRespaldo: true };
}
