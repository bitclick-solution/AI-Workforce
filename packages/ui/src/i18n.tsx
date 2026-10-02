'use client';

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

/** Idiomas que conoce el sistema de componentes. El castellano es el de referencia. */
export type Idioma = 'es' | 'en';

export const IDIOMA_DE_REFERENCIA: Idioma = 'es';

/** Claves de los textos que los propios componentes necesitan. */
export type ClaveDeTexto =
  | 'ui.boton.cargando'
  | 'ui.aviso.vacio'
  | 'ui.aviso.error'
  | 'ui.aviso.necesita-persona'
  | 'ui.aviso.informacion'
  | 'ui.aviso.aprobar'
  | 'ui.aviso.rechazar'
  | 'ui.campo.error'
  | 'ui.campo.opcional'
  | 'ui.porque.titulo'
  | 'ui.porque.mostrar'
  | 'ui.porque.ocultar'
  | 'ui.duracion.horas'
  | 'ui.duracion.minutos'
  | 'ui.duracion.segundos'
  | 'ui.widget.quitar'
  | 'ui.listaDeAvisos.vacio'
  | 'ui.avatar.teNecesita'
  | 'ui.avatar.trabajando'
  | 'ui.avatar.enEspera'
  | 'ui.avatar.personaSinNombre'
  | 'ui.presencia.en-la-sala'
  | 'ui.presencia.escribiendo'
  | 'ui.presencia.inactivo'
  | 'ui.presencia.anadido'
  | 'ui.presencia.trabajando'
  | 'ui.presencia.te-necesita'
  | 'ui.presencia.en-pausa'
  | 'ui.ia.etiqueta'
  | 'ui.ia.descripcion'
  | 'ui.miembros.titulo'
  | 'ui.miembros.filtros'
  | 'ui.miembros.filtro.todos'
  | 'ui.miembros.filtro.sala'
  | 'ui.miembros.filtro.inactivos'
  | 'ui.miembros.filtro.anadidos'
  | 'ui.miembros.personas'
  | 'ui.miembros.agentes'
  | 'ui.miembros.vacio'
  | 'ui.salas.titulo'
  | 'ui.salas.sinLeer.uno'
  | 'ui.salas.sinLeer.varios'
  | 'ui.salas.menciones.una'
  | 'ui.salas.menciones.varias'
  | 'ui.salas.vacio'
  | 'ui.escritura.uno'
  | 'ui.escritura.dos'
  | 'ui.escritura.varios'
  | 'ui.hoja.cerrar'
  | 'ui.propuesta.etiqueta'
  | 'ui.panelDeWidgets.rejilla'
  | 'ui.panelDeWidgets.subir'
  | 'ui.panelDeWidgets.bajar'
  | 'ui.panelDeWidgets.agrandar'
  | 'ui.panelDeWidgets.achicar'
  | 'ui.panelDeWidgets.ocultos'
  | 'ui.panelDeWidgets.mostrar'
  | 'ui.paso.lista'
  | 'ui.paso.sinPorque'
  | 'ui.paso.etiqueta.nivel'
  | 'ui.paso.etiqueta.coste'
  | 'ui.paso.etiqueta.resultado'
  | 'ui.paso.resultado.exito'
  | 'ui.paso.resultado.error'
  | 'ui.paso.resultado.rechazado'
  | 'ui.paso.resultado.parcial';

export type Diccionario = Partial<Record<ClaveDeTexto, string>>;

const CASTELLANO: Record<ClaveDeTexto, string> = {
  'ui.boton.cargando': 'Trabajando…',
  'ui.aviso.vacio': 'Todavía no hay nada',
  'ui.aviso.error': 'Algo ha fallado',
  'ui.aviso.necesita-persona': 'Necesita a una persona',
  'ui.aviso.informacion': 'Para que lo sepas',
  'ui.aviso.aprobar': 'Aprobar',
  'ui.aviso.rechazar': 'Rechazar',
  'ui.campo.error': 'Error',
  'ui.campo.opcional': 'opcional',
  'ui.porque.titulo': 'Por qué lo hice',
  'ui.porque.mostrar': 'Ver por qué lo hice',
  'ui.porque.ocultar': 'Ocultar por qué lo hice',
  'ui.duracion.horas': '{valor} h',
  'ui.duracion.minutos': '{valor} min',
  'ui.duracion.segundos': '{valor} s',
  'ui.widget.quitar': 'Quitar «{titulo}» del panel',
  'ui.listaDeAvisos.vacio': 'No hay avisos pendientes.',
  'ui.avatar.teNecesita': 'Te necesita',
  'ui.avatar.trabajando': 'Trabajando',
  'ui.avatar.enEspera': 'En espera',
  'ui.avatar.personaSinNombre': 'Persona sin nombre',
  'ui.presencia.en-la-sala': 'En la sala',
  'ui.presencia.escribiendo': 'Escribiendo…',
  'ui.presencia.inactivo': 'Inactivo',
  'ui.presencia.anadido': 'Añadido',
  'ui.presencia.trabajando': 'Trabajando',
  'ui.presencia.te-necesita': 'Te necesita',
  'ui.presencia.en-pausa': 'En pausa',
  'ui.ia.etiqueta': 'IA',
  'ui.ia.descripcion': 'Agente de IA',
  'ui.miembros.titulo': 'Miembros · {total}',
  'ui.miembros.filtros': 'Filtrar miembros',
  'ui.miembros.filtro.todos': 'Todos',
  'ui.miembros.filtro.sala': 'En la sala',
  'ui.miembros.filtro.inactivos': 'Inactivos',
  'ui.miembros.filtro.anadidos': 'Añadidos',
  'ui.miembros.personas': 'Personas · {n}',
  'ui.miembros.agentes': 'Agentes · {n}',
  'ui.miembros.vacio': 'Nadie en este filtro. Prueba con «Todos».',
  'ui.salas.titulo': 'Salas',
  'ui.salas.sinLeer.uno': '1 mensaje sin leer',
  'ui.salas.sinLeer.varios': '{n} mensajes sin leer',
  'ui.salas.menciones.una': '1 mención',
  'ui.salas.menciones.varias': '{n} menciones',
  'ui.salas.vacio': 'Todavía no hay salas.',
  'ui.escritura.uno': '{a} está escribiendo…',
  'ui.escritura.dos': '{a} y {b} están escribiendo…',
  'ui.escritura.varios': 'Varios miembros están escribiendo…',
  'ui.hoja.cerrar': 'Cerrar',
  'ui.propuesta.etiqueta': 'Propuesta',
  'ui.panelDeWidgets.rejilla': 'Widgets del inicio',
  'ui.panelDeWidgets.subir': 'Subir «{titulo}»',
  'ui.panelDeWidgets.bajar': 'Bajar «{titulo}»',
  'ui.panelDeWidgets.agrandar': 'Agrandar «{titulo}»',
  'ui.panelDeWidgets.achicar': 'Achicar «{titulo}»',
  'ui.panelDeWidgets.ocultos': 'Ocultos:',
  'ui.panelDeWidgets.mostrar': 'Mostrar «{titulo}»',
  'ui.paso.lista': 'Pasos del agente',
  'ui.paso.sinPorque': 'El libro de auditoría no anota el motivo de este paso.',
  'ui.paso.etiqueta.nivel': 'Nivel',
  'ui.paso.etiqueta.coste': 'Coste',
  'ui.paso.etiqueta.resultado': 'Resultado',
  'ui.paso.resultado.exito': 'Hecho',
  'ui.paso.resultado.error': 'Con error',
  'ui.paso.resultado.rechazado': 'No se hizo',
  'ui.paso.resultado.parcial': 'A medias',
};

const INGLES: Diccionario = {
  'ui.boton.cargando': 'Working…',
  'ui.aviso.vacio': 'Nothing here yet',
  'ui.aviso.error': 'Something went wrong',
  'ui.aviso.necesita-persona': 'Needs a person',
  'ui.aviso.informacion': 'For your information',
  'ui.campo.error': 'Error',
  'ui.campo.opcional': 'optional',
  'ui.porque.titulo': 'Why I did it',
  'ui.porque.mostrar': 'See why I did it',
  'ui.porque.ocultar': 'Hide why I did it',
  'ui.paso.lista': 'Agent steps',
  'ui.paso.sinPorque': 'The audit ledger does not record the reason for this step.',
  'ui.paso.etiqueta.nivel': 'Level',
  'ui.paso.etiqueta.coste': 'Cost',
  'ui.paso.etiqueta.resultado': 'Result',
  'ui.paso.resultado.exito': 'Done',
  'ui.paso.resultado.error': 'Failed',
  'ui.paso.resultado.rechazado': 'Not done',
  'ui.paso.resultado.parcial': 'Partly done',
  'ui.aviso.aprobar': 'Approve',
  'ui.aviso.rechazar': 'Reject',
  'ui.widget.quitar': 'Remove "{titulo}" from the panel',
  'ui.listaDeAvisos.vacio': 'No notices pending.',
  'ui.avatar.teNecesita': 'Needs you',
  'ui.avatar.trabajando': 'Working',
  'ui.avatar.enEspera': 'On hold',
  'ui.avatar.personaSinNombre': 'Unnamed person',
  'ui.presencia.en-la-sala': 'In the room',
  'ui.presencia.escribiendo': 'Typing…',
  'ui.presencia.inactivo': 'Idle',
  'ui.presencia.anadido': 'Added',
  'ui.presencia.trabajando': 'Working',
  'ui.presencia.te-necesita': 'Needs you',
  'ui.presencia.en-pausa': 'Paused',
  'ui.ia.etiqueta': 'AI',
  'ui.ia.descripcion': 'AI agent',
  'ui.miembros.titulo': 'Members · {total}',
  'ui.miembros.filtros': 'Filter members',
  'ui.miembros.filtro.todos': 'All',
  'ui.miembros.filtro.sala': 'In the room',
  'ui.miembros.filtro.inactivos': 'Idle',
  'ui.miembros.filtro.anadidos': 'Added',
  'ui.miembros.personas': 'People · {n}',
  'ui.miembros.agentes': 'Agents · {n}',
  'ui.miembros.vacio': 'Nobody here. Try "All".',
  'ui.salas.titulo': 'Rooms',
  'ui.salas.sinLeer.uno': '1 unread message',
  'ui.salas.sinLeer.varios': '{n} unread messages',
  'ui.salas.menciones.una': '1 mention',
  'ui.salas.menciones.varias': '{n} mentions',
  'ui.salas.vacio': 'No rooms yet.',
  'ui.escritura.uno': '{a} is typing…',
  'ui.escritura.dos': '{a} and {b} are typing…',
  'ui.escritura.varios': 'Several members are typing…',
  'ui.hoja.cerrar': 'Close',
  'ui.propuesta.etiqueta': 'Proposal',
  'ui.panelDeWidgets.rejilla': 'Home widgets',
  'ui.panelDeWidgets.subir': 'Move "{titulo}" up',
  'ui.panelDeWidgets.bajar': 'Move "{titulo}" down',
  'ui.panelDeWidgets.agrandar': 'Enlarge "{titulo}"',
  'ui.panelDeWidgets.achicar': 'Shrink "{titulo}"',
  'ui.panelDeWidgets.ocultos': 'Hidden:',
  'ui.panelDeWidgets.mostrar': 'Show "{titulo}"',
};

const DICCIONARIOS: Record<Idioma, Diccionario> = { es: CASTELLANO, en: INGLES };

export type Parametros = Record<string, string | number>;

/** Traduce una clave al idioma pedido y sustituye los parámetros `{nombre}`. */
export type Traductor = (clave: ClaveDeTexto, parametros?: Parametros) => string;

function sustituir(plantilla: string, parametros: Parametros | undefined): string {
  if (!parametros) return plantilla;
  return plantilla.replace(/\{(\w+)\}/g, (coincidencia, nombre: string) => {
    const valor = parametros[nombre];
    return valor === undefined ? coincidencia : String(valor);
  });
}

/**
 * Devuelve el traductor de un idioma. Si al idioma le falta una clave, cae al
 * castellano; si tampoco está allí, devuelve la clave, que es visible en
 * pantalla y por tanto detectable en una revisión.
 */
export function crearTraductor(idioma: Idioma): Traductor {
  const diccionario = DICCIONARIOS[idioma];
  return (clave, parametros) =>
    sustituir(diccionario[clave] ?? CASTELLANO[clave] ?? clave, parametros);
}

const ContextoDeIdioma = createContext<Idioma>(IDIOMA_DE_REFERENCIA);

export interface ProveedorDeIdiomaProps {
  idioma?: Idioma;
  children: ReactNode;
}

/** Fija el idioma para todos los componentes que cuelguen de él. */
export function ProveedorDeIdioma({ idioma, children }: ProveedorDeIdiomaProps) {
  return createElement(
    ContextoDeIdioma.Provider,
    { value: idioma ?? IDIOMA_DE_REFERENCIA },
    children,
  );
}

/** Traductor del idioma vigente. */
export function useTraduccion(): Traductor {
  const idioma = useContext(ContextoDeIdioma);
  return useMemo(() => crearTraductor(idioma), [idioma]);
}

/** Idioma vigente, para los textos que no vive en este paquete. */
export function useIdioma(): Idioma {
  return useContext(ContextoDeIdioma);
}
