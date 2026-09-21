/**
 * Las páginas del enlace de aprobación. Genéricas, por ADR-001.
 *
 * Genérica quiere decir dos cosas. Una: la página no sabe qué se aprueba; muestra
 * el resumen legible y la clase de acción, y nunca el borrador. Dos: la página no
 * revela si una aprobación existe. Un enlace con la firma mal, uno que apunta a una
 * aprobación de otro tenant y uno que apunta a una que no existe dan exactamente la
 * misma respuesta, porque la diferencia solo le sirve a quien está probando suerte.
 *
 * Con firma válida sí se distingue caducado y ya decidido: esa firma la emitimos
 * nosotros, así que quien la trae es la persona a la que se la mandamos y merece
 * saber por qué no puede decidir.
 */
import { documento, escaparHtml } from '../html.js';

export const SENTIDOS_BOTON = { aprobar: 'aprobar', rechazar: 'rechazar' } as const;

export type SentidoBoton = (typeof SENTIDOS_BOTON)[keyof typeof SENTIDOS_BOTON];

export interface DatosPaginaDecision {
  resumenLegible: string;
  claseAccion: string;
  nivelExigido: string;
  venceEn: Date | null;
  /** Ruta a la que envía el formulario. Lleva el token, igual que la de entrada. */
  accion: string;
}

function fila(etiqueta: string, valor: string): string {
  return `<dt>${escaparHtml(etiqueta)}</dt><dd>${escaparHtml(valor)}</dd>`;
}

export function paginaDeDecision(datos: DatosPaginaDecision): string {
  const filas = [
    fila('Clase de acción', datos.claseAccion),
    fila('Nivel exigido', datos.nivelExigido),
    datos.venceEn
      ? fila('Vence', `${datos.venceEn.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
      : '',
  ].join('');

  return documento(
    'Aprobación pendiente · AI Workforce',
    [
      '<h1>Un agente necesita tu permiso</h1>',
      `<blockquote>${escaparHtml(datos.resumenLegible)}</blockquote>`,
      `<dl>${filas}</dl>`,
      `<form method="post" action="${escaparHtml(datos.accion)}">`,
      '<div class="acciones">',
      `<button class="aprobar" type="submit" name="sentido" value="${SENTIDOS_BOTON.aprobar}">`,
      'Aprobar</button>',
      `<button class="rechazar" type="submit" name="sentido" value="${SENTIDOS_BOTON.rechazar}">`,
      'Rechazar</button>',
      '</div>',
      '</form>',
      '<footer>Este enlace sirve una sola vez. Al decidir, el agente continúa o se detiene, ',
      'y la decisión queda registrada con tu nombre.</footer>',
    ].join(''),
  );
}

export interface DatosPaginaResultado {
  titulo: string;
  mensaje: string;
  /** Detalle opcional: el sentido de la decisión que ya había, por ejemplo. */
  detalle?: string | undefined;
}

export function paginaDeResultado(datos: DatosPaginaResultado): string {
  return documento(
    `${datos.titulo} · AI Workforce`,
    [
      `<h1>${escaparHtml(datos.titulo)}</h1>`,
      `<p>${escaparHtml(datos.mensaje)}</p>`,
      datos.detalle ? `<footer>${escaparHtml(datos.detalle)}</footer>` : '',
    ].join(''),
  );
}

/** La misma respuesta para el token roto, el de otro tenant y el que no existe. */
export function paginaEnlaceNoValido(): string {
  return paginaDeResultado({
    titulo: 'Enlace no válido',
    mensaje:
      'Este enlace no sirve. Puede que se haya escrito mal, que se haya cortado al ' +
      'copiarlo o que ya no esté en vigor.',
    detalle: 'Si esperabas poder decidir algo, pídelo de nuevo desde el panel.',
  });
}

export function paginaCaducada(venceEn: Date | null): string {
  return paginaDeResultado({
    titulo: 'El enlace ha caducado',
    mensaje:
      'El plazo para decidir ha pasado, así que este enlace ya no decide nada. ' +
      'El agente se ha detenido y la aprobación queda rechazada por vencimiento.',
    detalle: venceEn
      ? `Venció el ${venceEn.toISOString().slice(0, 16).replace('T', ' ')} UTC.`
      : undefined,
  });
}

export function paginaYaDecidida(sentido: string | null): string {
  return paginaDeResultado({
    titulo: 'Este enlace ya se usó',
    mensaje:
      'La aprobación ya está resuelta y una aprobación se decide una sola vez. ' +
      'No se ha cambiado nada.',
    detalle: sentido ? `La decisión registrada fue: ${sentido}.` : undefined,
  });
}

export function paginaDecidida(sentido: 'aprobada' | 'rechazada'): string {
  return paginaDeResultado({
    titulo: sentido === 'aprobada' ? 'Aprobado' : 'Rechazado',
    mensaje:
      sentido === 'aprobada'
        ? 'Queda registrado. El agente continúa con la acción que pidió aprobar.'
        : 'Queda registrado. El agente se detiene y no ejecuta la acción.',
    detalle: 'Ya puedes cerrar esta página.',
  });
}
