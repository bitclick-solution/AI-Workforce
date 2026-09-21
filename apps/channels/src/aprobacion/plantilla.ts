/**
 * El correo que pide la aprobación.
 *
 * Lleva el resumen legible y un enlace. No lleva el borrador opaco: ADR-001 dice
 * que la carga del borrador no la interpreta el plano de control, y un correo es
 * el sitio menos indicado para volcar el detalle de un pago.
 *
 * No lleva dos enlaces, uno para aprobar y otro para rechazar, aunque sea lo que
 * primero se le ocurre a cualquiera. Los antivirus de correo, las pasarelas de
 * seguridad y algunos clientes precargan los enlaces de un mensaje para
 * comprobarlos: con enlaces que deciden, el pago se aprueba solo, sin que nadie
 * lea nada. El enlace muestra; los botones deciden, y deciden por POST.
 */
import type { CorreoSaliente } from '@aiw/domain';

import { escaparHtml } from '../html.js';

export interface DatosDelCorreo {
  para: string;
  remitente: string;
  resumenLegible: string;
  claseAccion: string;
  nivelExigido: string;
  venceEn: Date | null;
  url: string;
  /** Nombre de la organización, si se conoce. Solo decora el asunto. */
  organizacion?: string | undefined;
}

export function formatearMomento(momento: Date): string {
  // ISO recortado a minutos y con espacio: legible sin depender de la zona del
  // cliente de correo, y sin prometer una zona horaria que no es la de quien lee.
  return `${momento.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function asuntoDelCorreo(datos: DatosDelCorreo): string {
  const prefijo = datos.organizacion ? `[${datos.organizacion}] ` : '';
  return `${prefijo}Aprobación pendiente: ${primeraLinea(datos.resumenLegible)}`;
}

/** El asunto es una línea: el resumen puede traer saltos (\n, \r\n o \r suelto) y se recorta. */
function primeraLinea(texto: string, maximo = 90): string {
  const linea = texto.split(/\r\n|\r|\n/)[0]?.trim() ?? '';
  return linea.length <= maximo ? linea : `${linea.slice(0, maximo - 1)}…`;
}

export function componerCorreo(datos: DatosDelCorreo): CorreoSaliente {
  const vence = datos.venceEn
    ? `Puedes decidir hasta el ${formatearMomento(datos.venceEn)}.`
    : 'El enlace caduca pasado el plazo del enlace.';

  const texto = [
    'Un agente de AI Workforce necesita tu permiso para seguir.',
    '',
    datos.resumenLegible,
    '',
    `Clase de acción: ${datos.claseAccion}`,
    `Nivel exigido: ${datos.nivelExigido}`,
    vence,
    '',
    'Abre este enlace para ver el detalle y decidir:',
    datos.url,
    '',
    'El enlace es de un solo uso y personal: no lo reenvíes.',
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,sans-serif;max-width:34rem;line-height:1.5">',
    '<p>Un agente de AI Workforce necesita tu permiso para seguir.</p>',
    '<blockquote style="margin:1rem 0;padding:.85rem 1rem;background:#f6f6f5;',
    'border-left:3px solid #1d1d1b;white-space:pre-wrap">',
    escaparHtml(datos.resumenLegible),
    '</blockquote>',
    '<p style="color:#6b6b66;font-size:.9rem">',
    `Clase de acción: ${escaparHtml(datos.claseAccion)}<br>`,
    `Nivel exigido: ${escaparHtml(datos.nivelExigido)}<br>`,
    escaparHtml(vence),
    '</p>',
    `<p><a href="${escaparHtml(datos.url)}" `,
    'style="display:inline-block;padding:.7rem 1.2rem;background:#1d1d1b;color:#fff;',
    'border-radius:6px;text-decoration:none">Ver y decidir</a></p>',
    '<p style="color:#6b6b66;font-size:.85rem">',
    'El enlace es de un solo uso y personal: no lo reenvíes.',
    '</p>',
    '</div>',
  ].join('');

  return {
    de: datos.remitente,
    para: datos.para,
    asunto: asuntoDelCorreo(datos),
    texto,
    html,
  };
}
