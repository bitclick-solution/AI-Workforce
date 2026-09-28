/**
 * Correo del acceso: el enlace para entrar y el aviso de invitación.
 *
 * El contrato es `PuertoDeCorreo` de `@aiw/domain`, el mismo que usa la aprobación
 * por correo. `memoria` guarda el mensaje en el proceso (pruebas y demo sin Docker);
 * `smtp` lo manda de verdad, y en local eso es Mailpit. Con usuario vacío no se
 * manda `auth`: Mailpit no autentica.
 *
 * Las plantillas son texto y HTML mínimos, en español, sin nada que no sea el
 * enlace y a quién va: un enlace de acceso es una credencial de un solo uso y no
 * se adorna.
 */
import type { CorreoSaliente, PuertoDeCorreo, ResultadoEnvio } from '@aiw/domain';
import { createTransport } from 'nodemailer';

import type { ConfiguracionCorreoAcceso } from './configuracion.js';

export class CorreoEnMemoria implements PuertoDeCorreo {
  readonly enviados: CorreoSaliente[] = [];

  async enviar(correo: CorreoSaliente): Promise<ResultadoEnvio> {
    this.enviados.push(correo);
    return Promise.resolve({ id: `memoria-${this.enviados.length}`, proveedor: 'memoria' });
  }

  get ultimo(): CorreoSaliente | undefined {
    return this.enviados[this.enviados.length - 1];
  }
}

export function crearCorreo(configuracion: ConfiguracionCorreoAcceso): PuertoDeCorreo {
  if (configuracion.proveedor === 'memoria') return new CorreoEnMemoria();
  const { smtp } = configuracion;
  const transporte = createTransport({
    host: smtp.host,
    port: smtp.puerto,
    secure: smtp.seguro,
    ...(smtp.usuario.length > 0
      ? { auth: { user: smtp.usuario, pass: smtp.contrasena.revelar() } }
      : {}),
  });
  return {
    async enviar(correo) {
      const info = await transporte.sendMail({
        from: correo.de,
        to: correo.para,
        subject: correo.asunto,
        text: correo.texto,
        html: correo.html,
      });
      return { id: info.messageId ?? '', proveedor: 'smtp' };
    },
  };
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function correoDeEnlace(
  de: string,
  para: string,
  url: string,
  minutos: number,
): CorreoSaliente {
  const texto = [
    'Hola:',
    '',
    `Para entrar en el panel de AI Workforce, abre este enlace en los próximos ${minutos} minutos:`,
    '',
    url,
    '',
    'El enlace sirve una sola vez. Si no lo has pedido tú, no hagas nada: nadie entra sin él.',
  ].join('\n');
  const html = [
    '<p>Hola:</p>',
    `<p>Para entrar en el panel de AI Workforce, abre este enlace en los próximos ${minutos} minutos:</p>`,
    `<p><a href="${escaparHtml(url)}">Entrar en el panel</a></p>`,
    '<p>El enlace sirve una sola vez. Si no lo has pedido tú, no hagas nada: nadie entra sin él.</p>',
  ].join('\n');
  return { de, para, asunto: 'Tu enlace para entrar en AI Workforce', texto, html };
}

export function correoDeInvitacion(
  de: string,
  para: string,
  nombre: string,
  organizacion: string,
  urlAcceso: string,
): CorreoSaliente {
  const texto = [
    `Hola, ${nombre}:`,
    '',
    `Bitclick te ha dado acceso al panel de AI Workforce de ${organizacion}.`,
    `Entra en ${urlAcceso} con este correo: te llegará un enlace para entrar y, dentro, podrás registrar una passkey.`,
  ].join('\n');
  const html = [
    `<p>Hola, ${escaparHtml(nombre)}:</p>`,
    `<p>Bitclick te ha dado acceso al panel de AI Workforce de ${escaparHtml(organizacion)}.</p>`,
    `<p><a href="${escaparHtml(urlAcceso)}">Entra con este correo</a>: te llegará un enlace para entrar y, dentro, podrás registrar una passkey.</p>`,
  ].join('\n');
  return { de, para, asunto: 'Tienes acceso a AI Workforce', texto, html };
}
