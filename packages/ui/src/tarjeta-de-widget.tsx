'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface TarjetaDeWidgetProps {
  titulo: string;
  descripcion?: string;
  /** Controles adicionales de la cabecera, antes del botón de quitar. */
  acciones?: ReactNode;
  /** Si se pasa, aparece el botón de quitar el widget del panel. */
  alQuitar?: () => void;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Tarjeta de un widget del panel: título, contenido libre y quitar opcional. */
export function TarjetaDeWidget({
  titulo,
  descripcion,
  acciones,
  alQuitar,
  children,
  className,
  ...resto
}: TarjetaDeWidgetProps) {
  const t = useTraduccion();
  return (
    <section
      className={cn(TEMA.superficie.tarjeta, 'flex flex-col gap-3 p-4', className)}
      data-testid={resto['data-testid']}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className={cn(TEMA.texto.titulo, 'text-sm')}>{titulo}</h3>
          {descripcion ? (
            <p className={cn(TEMA.texto.apagado, 'mt-0.5 text-xs')}>{descripcion}</p>
          ) : null}
        </div>
        {acciones || alQuitar ? (
          <div className="flex items-center gap-1">
            {acciones}
            {alQuitar ? (
              <button
                type="button"
                onClick={alQuitar}
                aria-label={t('ui.widget.quitar', { titulo })}
                className={cn(TEMA.widget.boton, TEMA.foco)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {children ? <div className="flex-1">{children}</div> : null}
    </section>
  );
}
