'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface HojaMovilProps {
  abierta: boolean;
  titulo: string;
  alCerrar: () => void;
  /** `abajo`: hoja de miembros (S4). `izquierda`: cajón de salas (S4). */
  lado?: 'abajo' | 'izquierda';
  children: ReactNode;
  'data-testid'?: string;
}

/**
 * Hoja modal del móvil. `Escape` o el botón Cerrar la cierran, y el foco entra
 * en ella al abrirse y vuelve al control que la abrió al cerrarse. El foco no
 * sale de la hoja con el tabulador mientras está abierta.
 */
export function HojaMovil({
  abierta,
  titulo,
  alCerrar,
  lado = 'abajo',
  children,
  ...resto
}: HojaMovilProps) {
  const t = useTraduccion();
  const id = useId();
  const contenedor = useRef<HTMLDivElement>(null);
  const cerrar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierta) return undefined;
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cerrar.current?.focus();
    return () => {
      anterior?.focus();
    };
  }, [abierta]);

  if (!abierta) return null;

  const alPulsarTecla = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      alCerrar();
      return;
    }
    if (evento.key !== 'Tab' || !contenedor.current) return;
    const enfocables = contenedor.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const primero = enfocables[0];
    const ultimo = enfocables[enfocables.length - 1];
    if (!primero || !ultimo) return;
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  };

  return (
    <>
      <div aria-hidden="true" className={TEMA.hoja.fondo} onClick={alCerrar} />
      <div
        ref={contenedor}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        data-testid={resto['data-testid']}
        onKeyDown={alPulsarTecla}
        className={lado === 'abajo' ? TEMA.hoja.abajo : TEMA.hoja.izquierda}
      >
        <div className={TEMA.hoja.cabecera}>
          <h2 id={`${id}-titulo`} className={TEMA.hoja.titulo}>
            {titulo}
          </h2>
          <button
            ref={cerrar}
            type="button"
            onClick={alCerrar}
            aria-label={t('ui.hoja.cerrar')}
            data-testid="cerrar-hoja"
            className={cn(TEMA.hoja.cerrar, TEMA.foco)}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}
