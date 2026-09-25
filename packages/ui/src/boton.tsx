'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export type TonoDeBoton = 'primario' | 'secundario' | 'peligro';

export interface BotonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  children: ReactNode;
  tono?: TonoDeBoton;
  /** Deshabilita el control, marca `aria-busy` y anuncia que está trabajando. */
  cargando?: boolean;
  /** Nombre accesible cuando el contenido visible no basta (por ejemplo, solo un icono). */
  etiquetaAccesible?: string;
  ancho?: 'auto' | 'completo';
  className?: string;
}

/** Botón del sistema. Siempre `type="button"` salvo que se pida otra cosa. */
export function Boton({
  children,
  tono = 'primario',
  cargando = false,
  etiquetaAccesible,
  ancho = 'auto',
  className,
  disabled,
  type,
  ...resto
}: BotonProps) {
  const t = useTraduccion();
  return (
    <button
      {...resto}
      type={type ?? 'button'}
      disabled={disabled === true || cargando}
      aria-busy={cargando || undefined}
      aria-label={etiquetaAccesible}
      className={cn(
        TEMA.boton.base,
        TEMA.foco,
        TEMA.boton[tono],
        ancho === 'completo' && 'w-full',
        className,
      )}
    >
      {cargando ? t('ui.boton.cargando') : children}
    </button>
  );
}
