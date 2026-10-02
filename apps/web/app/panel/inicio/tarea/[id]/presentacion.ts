/**
 * Textos del detalle de la tarea: cómo se dice cada paso, estado y nivel en
 * castellano claro y sin jerga. Sin React ni red: se prueba suelto.
 */
import type { TonoDeInsignia } from '@aiw/ui';

import type { PasoDeLaTarea } from '../../../../../lib/inicio';

const NIVELES: Record<string, string> = {
  n0: 'N0 · manual',
  n1: 'N1 · supervisado',
  n2: 'N2 · autónomo con aviso',
  n3: 'N3 · autónomo con muestreo',
};

/** Nivel de autonomía (ADR-005) con su nombre. Un nivel desconocido se muestra tal cual. */
export function etiquetaDeNivel(nivel: string): string {
  return NIVELES[nivel] ?? nivel.toUpperCase();
}

const ESTADOS: Record<string, { etiqueta: string; tono: TonoDeInsignia }> = {
  pendiente: { etiqueta: 'Pendiente de arrancar', tono: 'neutro' },
  en_curso: { etiqueta: 'En curso', tono: 'neutro' },
  esperando_aprobacion: { etiqueta: 'Esperando tu aprobación', tono: 'aviso' },
  completada: { etiqueta: 'Completada', tono: 'exito' },
  fallida: { etiqueta: 'Con error', tono: 'peligro' },
  cancelada: { etiqueta: 'Cancelada', tono: 'neutro' },
};

export function estadoDeLaTarea(estado: string): { etiqueta: string; tono: TonoDeInsignia } {
  return ESTADOS[estado] ?? { etiqueta: estado, tono: 'neutro' };
}

/** Lo que hizo el agente en este paso, en una frase. */
export function tituloDelPaso(paso: PasoDeLaTarea): string {
  const herramienta = paso.herramienta ? `«${paso.herramienta}»` : 'una herramienta';
  switch (paso.tipo) {
    case 'arranque':
      return 'Recibió el encargo';
    case 'aprobacion_pedida':
      return 'Pidió tu aprobación';
    case 'decision':
      switch (paso.accion) {
        case 'aprobacion.aprobada':
          return 'Se aprobó';
        case 'aprobacion.rechazada':
          return 'Se rechazó';
        case 'aprobacion.editada':
          return 'Se aprobó con cambios';
        case 'aprobacion.vencida':
          return 'La aprobación venció sin respuesta';
        default:
          return 'Se decidió la aprobación';
      }
    case 'herramienta':
      switch (paso.accion) {
        case 'herramienta.rechazada':
          return `Intentó usar ${herramienta} y la política no se lo permitió`;
        case 'herramienta.simulada':
          return `Simuló ${herramienta}: no escribió nada de verdad`;
        case 'herramienta.saltada':
          return `No usó ${herramienta} porque se rechazó la aprobación`;
        default:
          return `Usó ${herramienta}`;
      }
  }
}
