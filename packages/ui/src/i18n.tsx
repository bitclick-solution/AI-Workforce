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
  | 'ui.campo.error'
  | 'ui.campo.opcional'
  | 'ui.porque.titulo'
  | 'ui.porque.mostrar'
  | 'ui.porque.ocultar'
  | 'ui.duracion.horas'
  | 'ui.duracion.minutos'
  | 'ui.duracion.segundos';

export type Diccionario = Partial<Record<ClaveDeTexto, string>>;

const CASTELLANO: Record<ClaveDeTexto, string> = {
  'ui.boton.cargando': 'Trabajando…',
  'ui.aviso.vacio': 'Todavía no hay nada',
  'ui.aviso.error': 'Algo ha fallado',
  'ui.aviso.necesita-persona': 'Necesita a una persona',
  'ui.aviso.informacion': 'Para que lo sepas',
  'ui.campo.error': 'Error',
  'ui.campo.opcional': 'opcional',
  'ui.porque.titulo': 'Por qué lo hice',
  'ui.porque.mostrar': 'Ver por qué lo hice',
  'ui.porque.ocultar': 'Ocultar por qué lo hice',
  'ui.duracion.horas': '{valor} h',
  'ui.duracion.minutos': '{valor} min',
  'ui.duracion.segundos': '{valor} s',
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
