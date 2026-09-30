/**
 * Traducción de la conversación del contrato (`MensajeDeSala`, `PropuestaDeSala`
 * en `lib/sala-contrato.ts`) a las cuatro formas que ya pinta la vista v1:
 * mensaje de texto, nota plegada del moderador, aviso de aprobación y tarjeta
 * de propuesta. Un solo sitio traduce el `tipo` de cada adjunto: ni `vista.tsx`
 * ni la fuente saben de estas formas.
 *
 * `aprobacion` (acción inmediata sin propuesta de operación) todavía no lo
 * emite la API real —ver el comentario de `AdjuntoDeSala` en `sala-contrato.ts`—,
 * así que solo aparece con la fuente simulada hasta que exista _De conversación
 * a trabajo_. `propuesta_operacion` sí lo emite la API real desde Sala v0.
 */
import type { DatoDePropuesta } from '@aiw/ui';

import type {
  AdjuntoDeSala,
  AutorDeMensaje,
  MensajeDeSala,
  PropuestaDeSala,
} from '../../../../lib/sala-contrato';

export interface AutorVisible {
  /** Sintético: la API no manda un identificador de autor, solo su nombre. */
  id: string;
  nombre: string;
  tipo: 'persona' | 'agente';
}

export type MensajeVisible =
  | { tipo: 'texto'; id: string; autor: AutorVisible; hora: string; texto: string }
  | { tipo: 'nota'; id: string; hora: string; texto: string }
  | {
      tipo: 'aprobacion';
      id: string;
      autor: AutorVisible;
      hora: string;
      texto: string;
      titulo: string;
      resumen: string;
      porque?: string;
    }
  | {
      tipo: 'propuesta';
      id: string;
      autor: AutorVisible;
      hora: string;
      texto: string;
      titulo: string;
      datos: DatoDePropuesta[];
      propuestaId: string;
      estado: string;
      /** Presente cuando la propuesta ya no está pendiente. */
      resuelta?: string;
    };

/** Mismas etiquetas que usa la vista v0 (`apps/web/app/panel/sala/vista.tsx`). */
export const ESTADO_DE_PROPUESTA_LEGIBLE: Record<string, string> = {
  pendiente: 'Pendiente de tu confirmación',
  aprobada: 'Aprobada',
  ejecutada: 'Contratado',
  rechazada: 'Descartada',
};

/** Hora corta de un mensaje; cadena vacía si `creadoEn` no es una fecha válida. */
export function horaCorta(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? ''
    : fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function idDeAutor(autor: AutorDeMensaje): string {
  return `${autor.tipo}-${autor.nombre}`.toLowerCase().replace(/\s+/g, '-');
}

function aAutorVisible(autor: AutorDeMensaje): AutorVisible {
  return {
    id: idDeAutor(autor),
    nombre: autor.nombre,
    tipo: autor.tipo === 'persona' ? 'persona' : 'agente',
  };
}

function esNotaDelModerador(adjuntos: readonly AdjuntoDeSala[]): boolean {
  return adjuntos.some((adjunto) => adjunto.tipo === 'moderacion');
}

function adjuntoDeTipo(
  adjuntos: readonly AdjuntoDeSala[],
  tipo: string,
): AdjuntoDeSala | undefined {
  return adjuntos.find((adjunto) => adjunto.tipo === tipo);
}

/** De `EfectosDeContratacion` a las filas etiqueta/valor de `TarjetaDePropuesta`. */
export function datosDePropuesta(propuesta: PropuestaDeSala): DatoDePropuesta[] {
  const { efectos } = propuesta;
  const datos: DatoDePropuesta[] = [
    { etiqueta: 'Nivel', valor: propuesta.nivelExigido.toUpperCase() },
  ];
  if (efectos.coste) {
    datos.push({
      etiqueta: 'Coste',
      valor: `${efectos.coste.eurosMesCliente} € al mes · unas ${efectos.coste.tareasMes} tareas`,
    });
  } else if (propuesta.costeEstimadoEuros > 0) {
    datos.push({ etiqueta: 'Coste', valor: `${propuesta.costeEstimadoEuros} € al mes` });
  }
  const herramientas = [
    ...(efectos.herramientas?.disponibles?.map((h) => h.nombre) ?? []),
    ...(efectos.herramientas?.porConectar?.map((h) => `${h.nombre} · por conectar`) ?? []),
  ];
  if (herramientas.length > 0) {
    datos.push({ etiqueta: 'Herramientas', valor: herramientas.join(', ') });
  }
  if (efectos.reversion?.descripcion) {
    datos.push({ etiqueta: 'Se deshace', valor: efectos.reversion.descripcion });
  }
  return datos;
}

/**
 * Traduce los mensajes de una sala (y las propuestas que citan) a las formas
 * que pinta la vista. El orden de llegada se conserva.
 */
export function aMensajesVisibles(
  mensajes: readonly MensajeDeSala[],
  propuestas: readonly PropuestaDeSala[],
): MensajeVisible[] {
  return mensajes.map((mensaje): MensajeVisible => {
    const hora = horaCorta(mensaje.creadoEn);

    if (esNotaDelModerador(mensaje.adjuntos)) {
      return { tipo: 'nota', id: mensaje.id, hora, texto: mensaje.cuerpo };
    }

    const aprobacion = adjuntoDeTipo(mensaje.adjuntos, 'aprobacion');
    if (aprobacion) {
      return {
        tipo: 'aprobacion',
        id: mensaje.id,
        autor: aAutorVisible(mensaje.autor),
        hora,
        texto: mensaje.cuerpo,
        titulo: aprobacion.titulo ?? mensaje.cuerpo,
        resumen: aprobacion.resumen ?? '',
        ...(aprobacion.porque ? { porque: aprobacion.porque } : {}),
      };
    }

    const deOperacion = adjuntoDeTipo(mensaje.adjuntos, 'propuesta_operacion');
    const propuesta = deOperacion
      ? propuestas.find((p) => p.id === deOperacion.propuestaId)
      : undefined;
    if (propuesta) {
      return {
        tipo: 'propuesta',
        id: mensaje.id,
        autor: aAutorVisible(mensaje.autor),
        hora,
        texto: mensaje.cuerpo,
        titulo: propuesta.efectos.puesto?.nombre ?? propuesta.resumen,
        datos: datosDePropuesta(propuesta),
        propuestaId: propuesta.id,
        estado: propuesta.estado,
        ...(propuesta.estado !== 'pendiente'
          ? { resuelta: ESTADO_DE_PROPUESTA_LEGIBLE[propuesta.estado] ?? propuesta.estado }
          : {}),
      };
    }

    return {
      tipo: 'texto',
      id: mensaje.id,
      autor: aAutorVisible(mensaje.autor),
      hora,
      texto: mensaje.cuerpo,
    };
  });
}
