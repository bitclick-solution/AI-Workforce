import type { ReactNode } from 'react';

import { cn } from './cn';
import { TEMA } from './tema';

export interface EstadoProps {
  titulo: string;
  children?: ReactNode;
  className?: string | undefined;
  'data-testid'?: string | undefined;
}

/** Tarjeta mínima de estado. */
export function Estado({ titulo, children, className, ...rest }: EstadoProps) {
  return (
    <section
      className={cn(TEMA.superficie.tarjeta, 'p-4', className)}
      data-testid={rest['data-testid']}
    >
      <h2 className={cn(TEMA.texto.titulo, 'text-lg')}>{titulo}</h2>
      {children ? <div className={cn(TEMA.texto.cuerpo, 'mt-2 text-sm')}>{children}</div> : null}
    </section>
  );
}
