/**
 * Textos del expediente: cómo se dice cada cambio de nivel, criterio y estado en
 * castellano claro. Sin React ni red: se prueba suelto.
 */
import type { TonoDeInsignia } from '@aiw/ui';

import type {
  AvanceHaciaElAscenso,
  CambioDeNivelDelExpediente,
  LeccionDelExpediente,
  MotivoSinAscenso,
  NivelDeAutonomia,
} from '../../../../../../lib/expediente';
import { etiquetaDeNivel } from '../../../tarea/[id]/presentacion';

export { etiquetaDeNivel };

/** «De N1 · supervisado a N2 · autónomo con aviso», o la clase que entra o sale de la política. */
export function fraseDelCambio(cambio: Pick<CambioDeNivelDelExpediente, 'de' | 'a'>): string {
  if (cambio.de === null && cambio.a !== null) {
    return `Entró en la política con ${etiquetaDeNivel(cambio.a)}`;
  }
  if (cambio.de !== null && cambio.a === null) {
    return `Salió de la política (tenía ${etiquetaDeNivel(cambio.de)})`;
  }
  if (cambio.de === null || cambio.a === null) return 'Cambió';
  const subio = rango(cambio.a) > rango(cambio.de);
  return `${subio ? 'Subió' : 'Bajó'} de ${etiquetaDeNivel(cambio.de)} a ${etiquetaDeNivel(cambio.a)}`;
}

function rango(nivel: NivelDeAutonomia): number {
  return ['n0', 'n1', 'n2', 'n3'].indexOf(nivel);
}

/** Qué versión lo produjo y, si la hubo, qué lección o decisión lo originó. */
export function origenDelCambio(
  cambio: CambioDeNivelDelExpediente,
  lecciones: LeccionDelExpediente[],
): string {
  const partes = [`Versión ${cambio.numeroVersion}`];
  if (cambio.leccionId) {
    const titulo = lecciones.find((l) => l.leccionId === cambio.leccionId)?.titulo;
    partes.push(titulo ? `por la lección «${titulo}»` : 'por una lección promocionada');
  }
  if (cambio.decididaPorPersonaId) partes.push('decidido por una persona');
  return partes.join(' · ');
}

const ESTADOS_DE_LECCION: Record<
  LeccionDelExpediente['estado'],
  { etiqueta: string; tono: TonoDeInsignia }
> = {
  vigente: { etiqueta: 'Vigente', tono: 'exito' },
  propuesta: { etiqueta: 'Propuesta', tono: 'aviso' },
  retirada: { etiqueta: 'Retirada', tono: 'neutro' },
};

export function estadoDeLaLeccion(estado: LeccionDelExpediente['estado']): {
  etiqueta: string;
  tono: TonoDeInsignia;
} {
  return ESTADOS_DE_LECCION[estado] ?? { etiqueta: estado, tono: 'neutro' };
}

/** Por qué una clase no enseña barra de progreso. «Fijo» se dice como fijo. */
export function textoSinAscenso(motivo: MotivoSinAscenso, nivel: NivelDeAutonomia | null): string {
  const donde = nivel ? etiquetaDeNivel(nivel) : 'su nivel';
  switch (motivo) {
    case 'fijo':
      return `Fijo en ${donde}: la primera versión no ofrece el ascenso en esta clase.`;
    case 'prohibida':
      return 'Prohibida: el agente no puede hacer nada de esta clase.';
    case 'nivel_maximo':
      return 'Ya está en el nivel más alto.';
    case 'sin_criterio':
      return `Sin ascenso definido desde ${donde} en esta versión.`;
  }
}

export interface CriterioDeAscenso {
  id: string;
  etiqueta: string;
  valor: string | null;
  requerido: string;
  progreso: number | null;
  cumplido: boolean;
}

const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** Los cuatro criterios del ADR-005 con su valor actual, listos para pintar. */
export function criteriosDelAscenso(a: AvanceHaciaElAscenso): CriterioDeAscenso[] {
  const { acciones, aprobadasSinCambiosPct: pct, diasSinIncidentes: dias, confirmacion } = a;
  return [
    {
      id: 'acciones',
      etiqueta: 'Acciones hechas',
      valor: `${numero.format(acciones.actual ?? 0)} de ${acciones.requerido}`,
      requerido: `al menos ${acciones.requerido}`,
      progreso: acciones.actual === null ? null : acciones.actual / acciones.requerido,
      cumplido: acciones.cumplido,
    },
    {
      id: 'aprobadas',
      etiqueta: 'Aprobadas sin cambios',
      valor: pct.actual === null ? null : `${numero.format(pct.actual)} %`,
      requerido: `al menos ${pct.requerido} %`,
      progreso: pct.actual === null ? null : pct.actual / pct.requerido,
      cumplido: pct.cumplido,
    },
    {
      id: 'dias',
      etiqueta: 'Días sin incidentes',
      valor: dias.actual === null ? null : `${numero.format(dias.actual)} de ${dias.requerido}`,
      requerido: `al menos ${dias.requerido}`,
      progreso: dias.actual === null ? null : dias.actual / dias.requerido,
      cumplido: dias.cumplido,
    },
    {
      id: 'confirmacion',
      etiqueta: 'Confirmación del supervisor',
      valor: confirmacion.confirmada ? 'Confirmada' : 'Sin confirmar',
      requerido: 'hace falta',
      progreso: confirmacion.confirmada ? 1 : 0,
      cumplido: confirmacion.cumplido,
    },
  ];
}

/** Enlace al paso de la tarea en el detalle de la tarea (#82), que ya controla el acceso. */
export function enlaceAlLibro(tareaId: string, numeroOrden: number): string {
  return `/panel/inicio/tarea/${encodeURIComponent(tareaId)}#paso-${numeroOrden}`;
}
