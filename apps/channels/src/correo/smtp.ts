/**
 * Correo por SMTP, para producción y para el Mailpit del Compose de desarrollo.
 *
 * El host, el puerto y el usuario son configuración; la contraseña llega envuelta
 * en `Secreto` y solo se revela al construir el transporte, que es el único sitio
 * que la necesita. Con usuario vacío no se manda `auth`: Mailpit no autentica y
 * pasarle credenciales vacías haría fallar el saludo.
 */
import type { CorreoSaliente, PuertoDeCorreo, ResultadoEnvio } from '@aiw/domain';
import { createTransport, type Transporter } from 'nodemailer';

import { ErrorDefinitivo } from '../reintentos.js';

import type { ConfiguracionSmtp } from '../aprobacion/configuracion.js';

export const PROVEEDOR_SMTP = 'smtp';

/**
 * Respuestas de SMTP que no mejoran por reintentar: el 5xx es un rechazo definitivo
 * («no existe ese buzón»), mientras que el 4xx es un «vuelve luego».
 */
export function esRechazoDefinitivo(error: unknown): boolean {
  if (error instanceof ErrorDefinitivo) return true;
  const respuesta = (error as { responseCode?: unknown } | null)?.responseCode;
  return typeof respuesta === 'number' && respuesta >= 500 && respuesta < 600;
}

export class CorreoSmtp implements PuertoDeCorreo {
  readonly #transporte: Transporter;

  constructor(configuracion: ConfiguracionSmtp, transporte?: Transporter) {
    this.#transporte =
      transporte ??
      createTransport({
        host: configuracion.host,
        port: configuracion.puerto,
        secure: configuracion.seguro,
        ...(configuracion.usuario.length > 0
          ? {
              auth: {
                user: configuracion.usuario,
                pass: configuracion.contrasena.revelar(),
              },
            }
          : {}),
      });
  }

  async enviar(correo: CorreoSaliente): Promise<ResultadoEnvio> {
    const info = await this.#transporte.sendMail({
      from: correo.de,
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
    });
    return { id: info.messageId ?? '', proveedor: PROVEEDOR_SMTP };
  }

  async cerrar(): Promise<void> {
    this.#transporte.close();
    return Promise.resolve();
  }
}
