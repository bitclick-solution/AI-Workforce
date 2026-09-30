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

import type { PeticionDeModelo, PuertoDeModelo, RespuestaDeModelo, TokensDeUso } from './puerto.js';

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

/** Un proveedor real y la forma de construir el puerto de cada papel en él. */
export interface ProveedorDePuertos {
  /** Nombre del proveedor (`bedrock-ue`, `vertex-ue`), el que eligen las variables de entorno. */
  proveedor: string;
  puerto: (papel: PapelModelo) => PuertoDeModelo;
}

/** Quién sirvió la respuesta: lo que el contador necesita para cobrarla. */
export interface Sirvio {
  proveedor: string;
  papel: PapelModelo;
  plataforma: string;
  /** Identificador que usó la plataforma (`eu.anthropic.claude-sonnet-4-6`). */
  modeloId: string;
}

/** Un intento que no sirvió la respuesta final. Los tokens de un rechazo se facturan igual. */
export interface IntentoFallido extends Sirvio {
  motivo: 'rechazo' | 'error';
  detalle: string;
  tokens: TokensDeUso;
}

export interface RespuestaEnrutada<T = unknown> {
  resultado: RespuestaDeModelo<T>;
  sirvio: Sirvio;
  intentosFallidos: IntentoFallido[];
}

export interface PuertoEnrutado {
  readonly papel: PapelModelo;
  completar<T = unknown>(peticion: PeticionDeModelo<T>): Promise<RespuestaEnrutada<T>>;
}

export interface OpcionesPuertoEnrutado {
  papel: PapelModelo;
  /** Papel que prueba el puesto tras un rechazo del clasificador (ADR-018). */
  papelRespaldo?: PapelModelo | null | undefined;
  principal: ProveedorDePuertos;
  /** Proveedor al que pasa la petición si el principal falla. Sin él, el error se propaga. */
  respaldo?: ProveedorDePuertos | null | undefined;
}

const SIN_TOKENS: TokensDeUso = { entrada: 0, salida: 0, entradaCache: 0 };

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quienSirvio(
  proveedor: ProveedorDePuertos,
  papel: PapelModelo,
  puerto: PuertoDeModelo,
): Sirvio {
  return {
    proveedor: proveedor.proveedor,
    papel,
    plataforma: puerto.plataforma,
    modeloId: puerto.modelo,
  };
}

/**
 * Puerto de un puesto: el proveedor principal, el respaldo de proveedor y el
 * respaldo de papel, en ese orden (ADR-018, ADR-023).
 *
 * - **Error del proveedor** (red, cuota, credenciales, 5xx): la misma petición pasa,
 *   una vez, al proveedor de respaldo con el mismo papel. Si también falla, se lanza
 *   el error del principal con el del respaldo anotado, y quien llama (Temporal)
 *   reintenta.
 * - **Rechazo del clasificador**: no se reintenta con el mismo modelo; se prueba el
 *   papel de respaldo del puesto en el proveedor que sirvió la primera respuesta.
 *
 * El rechazo que no tiene respaldo se devuelve como rechazo: es un paso fallido no
 * reintentable, no una excepción.
 */
export function crearPuertoEnrutado(opciones: OpcionesPuertoEnrutado): PuertoEnrutado {
  const { papel, papelRespaldo, principal, respaldo } = opciones;
  return {
    papel,
    async completar<T>(peticion: PeticionDeModelo<T>): Promise<RespuestaEnrutada<T>> {
      const intentosFallidos: IntentoFallido[] = [];
      let proveedor = principal;
      let puerto: PuertoDeModelo;
      let resultado: RespuestaDeModelo<T>;

      try {
        puerto = principal.puerto(papel);
        resultado = await puerto.completar(peticion);
      } catch (errorPrincipal) {
        if (!respaldo) throw errorPrincipal;
        proveedor = respaldo;
        try {
          puerto = respaldo.puerto(papel);
          resultado = await puerto.completar(peticion);
        } catch (errorRespaldo) {
          throw new Error(
            `${mensajeDe(errorPrincipal)} — el proveedor de respaldo ${respaldo.proveedor} ` +
              `también falló: ${mensajeDe(errorRespaldo)}`,
            { cause: errorRespaldo },
          );
        }
        intentosFallidos.push({
          proveedor: principal.proveedor,
          papel,
          plataforma: '',
          modeloId: '',
          motivo: 'error',
          detalle: mensajeDe(errorPrincipal),
          tokens: SIN_TOKENS,
        });
      }

      if (resultado.tipo === 'rechazo' && papelRespaldo && papelRespaldo !== papel) {
        intentosFallidos.push({
          ...quienSirvio(proveedor, papel, puerto),
          motivo: 'rechazo',
          detalle: resultado.categoria ?? resultado.explicacion ?? 'rechazo del clasificador',
          tokens: resultado.tokens,
        });
        puerto = proveedor.puerto(papelRespaldo);
        resultado = await puerto.completar(peticion);
        return {
          resultado,
          sirvio: quienSirvio(proveedor, papelRespaldo, puerto),
          intentosFallidos,
        };
      }

      return { resultado, sirvio: quienSirvio(proveedor, papel, puerto), intentosFallidos };
    },
  };
}
