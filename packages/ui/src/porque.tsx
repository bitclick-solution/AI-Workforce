'use client';

import { useState, type ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface PorqueProps {
  /** Necesario: enlaza el control con la región que despliega. */
  id: string;
  /** Sustituye al título por defecto («Por qué lo hice»). */
  titulo?: string;
  children: ReactNode;
  abiertoPorDefecto?: boolean;
  className?: string;
}

/**
 * «Por qué lo hice»: el motivo de una intervención, plegado por defecto.
 * Está en el sistema de componentes y no en una pantalla porque toda acción del
 * producto tiene que poder explicarse, y siempre de la misma forma.
 */
export function Porque({
  id,
  titulo,
  children,
  abiertoPorDefecto = false,
  className,
}: PorqueProps) {
  const t = useTraduccion();
  const [abierto, setAbierto] = useState(abiertoPorDefecto);
  const idRegion = `${id}-region`;

  return (
    <div className={cn('rounded-lg border border-neutral-200', className)}>
      <button
        type="button"
        id={id}
        aria-expanded={abierto}
        aria-controls={idRegion}
        onClick={() => setAbierto((anterior) => !anterior)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
      >
        <span>{titulo ?? t('ui.porque.titulo')}</span>
        <span className={cn(TEMA.texto.apagado, 'text-xs font-normal')}>
          {abierto ? t('ui.porque.ocultar') : t('ui.porque.mostrar')}
        </span>
      </button>
      <div
        id={idRegion}
        role="region"
        aria-labelledby={id}
        hidden={!abierto}
        className="border-t border-neutral-200 px-3 py-3 text-sm text-neutral-700"
      >
        {children}
      </div>
    </div>
  );
}
