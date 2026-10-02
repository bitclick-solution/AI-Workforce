'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface CambioEnLinea {
  id: string;
  /** Qué cambió, en una frase: «De N1 · supervisado a N2 · autónomo con aviso». */
  titulo: string;
  /** Cuándo, ya formateado. */
  cuando: string;
  /** Instante ISO, para `<time>`. */
  instante?: string;
  /** Quién o qué lo originó, la versión… */
  children?: ReactNode;
}

export interface LineaDeNivelesProps {
  /** El nivel con el que empezó, dicho en una frase: «Empezó en N1 · supervisado». */
  inicial: string;
  /** De más antiguo a más reciente. */
  cambios: CambioEnLinea[];
  className?: string;
  'data-testid'?: string;
}

/**
 * Cómo ha cambiado el nivel de autonomía de una clase de acción: el nivel inicial
 * y cada cambio con su fecha. Una lista ordenada: el orden se lee sin ver la línea.
 */
export function LineaDeNiveles({ inicial, cambios, className, ...resto }: LineaDeNivelesProps) {
  const t = useTraduccion();
  return (
    <ol
      aria-label={t('ui.linea.lista')}
      className={cn(TEMA.linea.lista, 'gap-3', className)}
      data-testid={resto['data-testid']}
    >
      <li className="relative">
        <span aria-hidden="true" className={TEMA.linea.punto} />
        <p className={cn(TEMA.texto.cuerpo, 'text-sm')}>{inicial}</p>
      </li>
      {cambios.map((cambio) => (
        <li key={cambio.id} className="relative">
          <span aria-hidden="true" className={TEMA.linea.punto} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={cn(TEMA.texto.titulo, 'text-sm')}>{cambio.titulo}</p>
            <time className={cn(TEMA.texto.apagado, 'text-xs')} dateTime={cambio.instante}>
              {cambio.cuando}
            </time>
          </div>
          {cambio.children ? (
            <div className={cn(TEMA.texto.apagado, 'mt-0.5 text-xs')}>{cambio.children}</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
