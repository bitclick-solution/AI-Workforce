import type { ReactNode } from 'react';

import { cn } from './cn';
import { TEMA } from './tema';

export interface TarjetaProps {
  titulo: string;
  /** Nivel del encabezado, para no romper el orden de la página. */
  nivel?: 2 | 3 | 4;
  descripcion?: string;
  cabecera?: ReactNode;
  pie?: ReactNode;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Contenedor con título, contenido y pie. Sin lógica: solo estructura. */
export function Tarjeta({
  titulo,
  nivel = 2,
  descripcion,
  cabecera,
  pie,
  children,
  className,
  ...resto
}: TarjetaProps) {
  const Encabezado = `h${nivel}` as const;
  return (
    <section
      className={cn(TEMA.superficie.tarjeta, 'p-4 sm:p-6', className)}
      data-testid={resto['data-testid']}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Encabezado className={cn(TEMA.texto.titulo, 'text-lg')}>{titulo}</Encabezado>
          {descripcion ? (
            <p className={cn(TEMA.texto.cuerpo, 'mt-1 text-sm')}>{descripcion}</p>
          ) : null}
        </div>
        {cabecera ? <div className="flex flex-wrap items-center gap-2">{cabecera}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
      {pie ? <div className="mt-5 border-t border-linea pt-4">{pie}</div> : null}
    </section>
  );
}
