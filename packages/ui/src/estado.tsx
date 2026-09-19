import type { ReactNode } from 'react';

import { cn } from './cn';

export interface EstadoProps {
  titulo: string;
  children?: ReactNode;
  className?: string | undefined;
  'data-testid'?: string | undefined;
}

/** Tarjeta mínima de estado. Sustituida por el sistema de diseño en la rebanada del Diseñador. */
export function Estado({ titulo, children, className, ...rest }: EstadoProps) {
  return (
    <section
      className={cn('rounded-lg border border-neutral-300 p-4', className)}
      data-testid={rest['data-testid']}
    >
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children ? <div className="mt-2 text-sm text-neutral-700">{children}</div> : null}
    </section>
  );
}
