'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  marcarEdicion,
  RECORRIDO_INICIAL,
  sellar,
  sumarTareas,
  type Hito,
  type Recorrido,
} from './recorrido';

interface ValorDelRecorrido {
  recorrido: Recorrido;
  sellarHito: (hito: Hito) => void;
  anotarTareas: (tareas: number) => void;
  anotarEdicion: () => void;
  reiniciar: () => void;
}

const Contexto = createContext<ValorDelRecorrido | null>(null);

/**
 * Estado del recorrido, en memoria del navegador. Recargar la página entera lo
 * reinicia a propósito: cada sesión de prueba con un gerente empieza limpia.
 */
export function ProveedorDelRecorrido({ children }: { children: ReactNode }) {
  const [recorrido, setRecorrido] = useState<Recorrido>(RECORRIDO_INICIAL);

  const sellarHito = useCallback((hito: Hito) => {
    setRecorrido((anterior) => sellar(anterior, hito, Date.now()));
  }, []);

  const anotarTareas = useCallback((tareas: number) => {
    setRecorrido((anterior) => sumarTareas(anterior, tareas));
  }, []);

  const anotarEdicion = useCallback(() => {
    setRecorrido((anterior) => marcarEdicion(anterior));
  }, []);

  const reiniciar = useCallback(() => {
    setRecorrido(RECORRIDO_INICIAL);
  }, []);

  const valor = useMemo(
    () => ({ recorrido, sellarHito, anotarTareas, anotarEdicion, reiniciar }),
    [recorrido, sellarHito, anotarTareas, anotarEdicion, reiniciar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useRecorrido(): ValorDelRecorrido {
  const valor = useContext(Contexto);
  if (valor === null) {
    throw new Error('useRecorrido necesita estar dentro de ProveedorDelRecorrido.');
  }
  return valor;
}
