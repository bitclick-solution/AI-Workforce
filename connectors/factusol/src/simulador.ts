/**
 * Factusol MCP simulado para las pruebas de la confirmación.
 *
 * Lleva el ciclo del borrador con las formas reales de las muestras del Probador (1-10): `draft_modificar_cliente` crea un
 * borrador con su diff, `cancelar_borrador` lo tira, `get_estado_borrador` dice en qué
 * quedó y `confirmar_operacion` solo vale con el token de confirmación: con el del agente
 * el servidor lo bloquea y no escribe nada. Las lecturas salen de las grabaciones. Los
 * datos son inventados; la forma del borrador es la provisional de `src/borrador.ts`.
 */
import { clienteGrabado, type ClienteFactusol, type RespuestaFactusol } from './cliente.js';
import { cargarGrabaciones } from './grabaciones/index.js';

export type EstadoSimulado = 'pendiente' | 'ya_ejecutado' | 'cancelado' | 'caducado';

export interface BorradorSimulado {
  readonly id: string;
  estado: EstadoSimulado;
  readonly actual: string;
  readonly nuevo: string;
}

export interface OpcionesSimulador {
  /** Observaciones del cliente antes de escribir. */
  readonly observaciones?: string;
  /** Altera `borrador.cuerpo.campos` de `draft_modificar_cliente`, para probar «no coincide». */
  readonly alterarCambios?: (campos: Record<string, unknown>[]) => Record<string, unknown>[];
  /** `confirmar_operacion` contesta bien pero el borrador ya había caducado. */
  readonly caducaAlConfirmar?: boolean;
  /** `confirmar_operacion` falla con este texto (p. ej. un corte de red). */
  readonly confirmarFalla?: () => string | undefined;
}

export interface LlamadaSimulada {
  readonly via: 'agente' | 'confirmar';
  readonly herramienta: string;
  readonly argumentos: Record<string, unknown>;
}

export function simularFactusol(opciones: OpcionesSimulador = {}): {
  readonly agente: ClienteFactusol;
  readonly confirmar: ClienteFactusol;
  readonly llamadas: LlamadaSimulada[];
  readonly borradores: Map<string, BorradorSimulado>;
  observaciones(): string;
  responder(
    via: 'agente' | 'confirmar',
    herramienta: string,
    argumentos: Record<string, unknown>,
  ): Promise<RespuestaFactusol>;
} {
  const lecturas = clienteGrabado(cargarGrabaciones());
  const llamadas: LlamadaSimulada[] = [];
  const borradores = new Map<string, BorradorSimulado>();
  let observaciones = opciones.observaciones ?? 'Cliente de prueba.';

  function camposDe(borrador: BorradorSimulado): Record<string, unknown>[] {
    const campos = [
      {
        nombre: 'Observaciones',
        valor_actual: borrador.actual,
        valor_nuevo: borrador.nuevo,
        cambia: true,
      },
    ];
    return opciones.alterarCambios === undefined ? campos : opciones.alterarCambios(campos);
  }

  async function responder(
    via: 'agente' | 'confirmar',
    herramienta: string,
    argumentos: Record<string, unknown>,
  ): Promise<RespuestaFactusol> {
    llamadas.push({ via, herramienta, argumentos });
    switch (herramienta) {
      case 'draft_modificar_cliente': {
        const borrador: BorradorSimulado = {
          id: `dft_${String(borradores.size + 1).padStart(4, '0')}`,
          estado: 'pendiente',
          actual: observaciones,
          nuevo: String(argumentos['observaciones']),
        };
        borradores.set(borrador.id, borrador);
        return {
          texto: '',
          estructurado: {
            texto: '📋 **BORRADOR · Modificar cliente**',
            borrador: {
              draft_id: borrador.id,
              tipo: 'modificar_cliente',
              caduca_en: '2026-10-01T19:29:32+00:00',
              cuerpo: {
                entidad: 'cliente',
                operacion: 'modificacion',
                identificador: String(argumentos['cliente']),
                campos: camposDe(borrador),
              },
            },
          },
        };
      }
      case 'cancelar_borrador': {
        const borrador = borradores.get(String(argumentos['draft_id']));
        if (borrador?.estado === 'pendiente') borrador.estado = 'cancelado';
        return { texto: 'Borrador cancelado.' };
      }
      case 'get_estado_borrador': {
        const borrador = borradores.get(String(argumentos['draft_id']));
        if (borrador === undefined) return { texto: 'No se ha encontrado el borrador.' };
        const ejecutado = borrador.estado === 'ya_ejecutado';
        return {
          texto: '',
          estructurado: {
            texto: 'estado del borrador',
            accion: 'modificar_cliente',
            documentos: ejecutado ? [{ tabla: 'F_CLI', codigo: 12 }] : [],
            resultado: ejecutado ? 'ok' : null,
            estado: borrador.estado,
            escrito: ejecutado ? 'si' : 'no',
          },
        };
      }
      case 'confirmar_operacion': {
        if (via !== 'confirmar') {
          // El servidor real: «el asistente no puede confirmar operaciones por sí solo».
          throw new Error('403 Forbidden: el asistente no puede confirmar operaciones por sí solo');
        }
        const fallo = opciones.confirmarFalla?.();
        if (fallo !== undefined) throw new Error(fallo);
        const borrador = borradores.get(String(argumentos['draft_id']));
        if (borrador === undefined) return { texto: 'No se ha encontrado el borrador.' };
        if (opciones.caducaAlConfirmar === true) {
          borrador.estado = 'caducado';
          return { texto: 'El borrador ha caducado.' };
        }
        if (borrador.estado === 'pendiente') {
          borrador.estado = 'ya_ejecutado';
          observaciones = borrador.nuevo;
        }
        return { texto: 'Operación confirmada.' };
      }
      default:
        return lecturas.llamar(herramienta, argumentos);
    }
  }

  return {
    agente: { llamar: (h, a) => responder('agente', h, a), cerrar: () => Promise.resolve() },
    confirmar: { llamar: (h, a) => responder('confirmar', h, a), cerrar: () => Promise.resolve() },
    llamadas,
    borradores,
    observaciones: () => observaciones,
    responder,
  };
}
