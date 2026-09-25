import { Children, type ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface ListaDeAvisosProps {
  titulo: string;
  /** Cada hijo es un aviso: `Aviso` o `AvisoDeAprobacion`. */
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Columna de avisos del panel: «Te necesitan» con sus tarjetas, una por elemento. */
export function ListaDeAvisos({ titulo, children, className, ...resto }: ListaDeAvisosProps) {
  const t = useTraduccion();
  const avisos = Children.toArray(children);
  return (
    <section
      aria-label={titulo}
      data-testid={resto['data-testid']}
      className={cn('flex flex-col gap-3', className)}
    >
      <h2 className={cn(TEMA.texto.titulo, 'text-base')}>{titulo}</h2>
      {avisos.length === 0 ? (
        <p className={cn(TEMA.texto.apagado, 'text-sm')}>{t('ui.listaDeAvisos.vacio')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {avisos.map((aviso, indice) => (
            <li key={indice}>{aviso}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
