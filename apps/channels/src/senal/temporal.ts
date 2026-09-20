/**
 * Señal contra Temporal: la decisión llega al flujo durable de la tarea.
 *
 * Cada tarea es un flujo de Temporal (frontera de arquitectura) y su identificador
 * vive en `tarea.flujo_temporal_id`. Aquí no se implementa el flujo ni se sabe qué
 * hace con la decisión: solo se entrega la señal por su nombre, que es lo mínimo
 * que acopla este canal con el bucle del agente que llegará en la prueba técnica.
 *
 * El flujo que no existe o que ya terminó produce un error, no un silencio: quien
 * llama lo anota con `resultado: 'error'` y queda constancia de qué reintentar.
 */
import type { CargaSenalDecision, DestinoDeFlujo, PuertoDeSenal } from '@aiw/domain';
import { Client, Connection } from '@temporalio/client';

export const PROVEEDOR_TEMPORAL = 'temporal';

export interface OpcionesTemporal {
  direccion: string;
  espacio: string;
}

export class SenalTemporal implements PuertoDeSenal {
  readonly #cliente: Client;
  readonly #conexion: Connection | undefined;

  constructor(cliente: Client, conexion?: Connection) {
    this.#cliente = cliente;
    this.#conexion = conexion;
  }

  /** Abre la conexión. Se llama una vez al arrancar, no por cada señal. */
  static async conectar(opciones: OpcionesTemporal): Promise<SenalTemporal> {
    const conexion = await Connection.connect({ address: opciones.direccion });
    const cliente = new Client({ connection: conexion, namespace: opciones.espacio });
    return new SenalTemporal(cliente, conexion);
  }

  async entregar(destino: DestinoDeFlujo, carga: CargaSenalDecision): Promise<void> {
    const flujo = this.#cliente.workflow.getHandle(destino.flujoId);
    await flujo.signal(destino.nombreSenal, carga);
  }

  async cerrar(): Promise<void> {
    await this.#conexion?.close();
  }
}
