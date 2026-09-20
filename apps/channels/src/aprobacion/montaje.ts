/**
 * Monta los puertos que pide la configuración.
 *
 * Es el único sitio donde se elige implementación, y se elige con un dato del
 * entorno: `memoria` para desarrollo y pruebas, `smtp` y `temporal` para de verdad.
 * El resto del código solo conoce los puertos, así que cambiar de proveedor no
 * toca ni el servicio ni el servidor.
 */
import type { PuertoDeCorreo, PuertoDeSenal } from '@aiw/domain';

import { CorreoEnMemoria } from '../correo/memoria.js';
import { CorreoSmtp } from '../correo/smtp.js';
import { SenalEnMemoria } from '../senal/memoria.js';
import { SenalTemporal } from '../senal/temporal.js';

import type { ConfiguracionAprobacion } from './configuracion.js';

export interface PuertosMontados {
  correo: PuertoDeCorreo;
  senal: PuertoDeSenal;
  cerrar: () => Promise<void>;
}

export async function montarPuertos(
  configuracion: ConfiguracionAprobacion,
): Promise<PuertosMontados> {
  const correo =
    configuracion.correo.proveedor === 'smtp'
      ? new CorreoSmtp(configuracion.correo.smtp)
      : new CorreoEnMemoria();

  const senal =
    configuracion.senal.proveedor === 'temporal'
      ? await SenalTemporal.conectar({
          direccion: configuracion.senal.direccionTemporal,
          espacio: configuracion.senal.espacioTemporal,
        })
      : new SenalEnMemoria();

  return {
    correo,
    senal,
    cerrar: async () => {
      if (correo instanceof CorreoSmtp) await correo.cerrar();
      if (senal instanceof SenalTemporal) await senal.cerrar();
    },
  };
}
