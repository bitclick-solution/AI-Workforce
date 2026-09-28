'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface DatoDePropuesta {
  etiqueta: string;
  valor: string;
}

export interface TarjetaDePropuestaProps {
  titulo: string;
  /** Equipo y nivel, coste, herramientas y cómo se deshace: nada importante sin verse. */
  datos: readonly DatoDePropuesta[];
  /** Botones: «Contratar», «Ver la ficha». */
  acciones?: ReactNode;
  /** Texto cuando ya se decidió; sustituye a las acciones. */
  resuelta?: string;
  className?: string;
  'data-testid'?: string;
}

/** Propuesta de un agente dentro de la sala (S2 y S4), igual que en Avisos. */
export function TarjetaDePropuesta({
  titulo,
  datos,
  acciones,
  resuelta,
  className,
  ...resto
}: TarjetaDePropuestaProps) {
  const t = useTraduccion();
  return (
    <section
      aria-label={`${t('ui.propuesta.etiqueta')}: ${titulo}`}
      data-testid={resto['data-testid']}
      className={cn(TEMA.propuesta.contenedor, className)}
    >
      <p className={TEMA.propuesta.etiqueta}>{t('ui.propuesta.etiqueta')}</p>
      <h3 className={cn(TEMA.texto.titulo, 'mt-1 text-base')}>{titulo}</h3>
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {datos.map((dato) => (
          <div key={dato.etiqueta}>
            <dt className={TEMA.propuesta.dato}>{dato.etiqueta}</dt>
            <dd className={TEMA.propuesta.valor}>{dato.valor}</dd>
          </div>
        ))}
      </dl>
      {resuelta ? (
        <p role="status" className={cn(TEMA.propuesta.hecha, 'mt-4')}>
          {resuelta}
        </p>
      ) : acciones ? (
        <div className="mt-4 flex flex-wrap gap-2">{acciones}</div>
      ) : null}
    </section>
  );
}
