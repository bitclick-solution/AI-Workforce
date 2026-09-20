/**
 * Señal en memoria: guarda la entrega en vez de mandarla a Temporal.
 *
 * Es el proveedor por defecto y el de las pruebas. En este entorno no hay servidor
 * de Temporal —solo existe en el Compose y en la máquina de Jesús—, así que la
 * única forma de comprobar que la decisión sale con la carga correcta es capturarla.
 */
import type { CargaSenalDecision, DestinoDeFlujo, PuertoDeSenal } from '@aiw/domain';

export interface EntregaCapturada {
  destino: DestinoDeFlujo;
  carga: CargaSenalDecision;
}

export class SenalEnMemoria implements PuertoDeSenal {
  readonly entregadas: EntregaCapturada[] = [];

  async entregar(destino: DestinoDeFlujo, carga: CargaSenalDecision): Promise<void> {
    this.entregadas.push({ destino, carga });
    return Promise.resolve();
  }

  get ultima(): EntregaCapturada | undefined {
    return this.entregadas[this.entregadas.length - 1];
  }

  vaciar(): void {
    this.entregadas.length = 0;
  }
}
