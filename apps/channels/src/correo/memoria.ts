/**
 * Correo en memoria: el proveedor de desarrollo y de pruebas.
 *
 * No hay servidor de correo en este entorno ni en la integración continua, así que
 * el camino por defecto guarda el correo en una lista y devuelve un identificador.
 * Sirve para la demo sin Docker y para que las pruebas comprueben lo que se envía,
 * que es justo lo que no se puede comprobar con un servidor real.
 */
import type { CorreoSaliente, PuertoDeCorreo, ResultadoEnvio } from '@aiw/domain';

export const PROVEEDOR_MEMORIA = 'memoria';

export class CorreoEnMemoria implements PuertoDeCorreo {
  readonly enviados: CorreoSaliente[] = [];

  async enviar(correo: CorreoSaliente): Promise<ResultadoEnvio> {
    this.enviados.push(correo);
    return Promise.resolve({
      id: `${PROVEEDOR_MEMORIA}-${this.enviados.length}`,
      proveedor: PROVEEDOR_MEMORIA,
    });
  }

  get ultimo(): CorreoSaliente | undefined {
    return this.enviados[this.enviados.length - 1];
  }

  vaciar(): void {
    this.enviados.length = 0;
  }
}
