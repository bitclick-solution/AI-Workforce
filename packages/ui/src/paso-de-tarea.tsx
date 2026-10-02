'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion, type ClaveDeTexto } from './i18n';
import { Insignia, type TonoDeInsignia } from './insignia';
import { Porque } from './porque';
import { TEMA } from './tema';

export type ResultadoDePaso = 'exito' | 'error' | 'rechazado' | 'parcial';

const TONO: Record<ResultadoDePaso, TonoDeInsignia> = {
  exito: 'exito',
  error: 'peligro',
  rechazado: 'aviso',
  parcial: 'aviso',
};

const CLAVE_DE_RESULTADO: Record<ResultadoDePaso, ClaveDeTexto> = {
  exito: 'ui.paso.resultado.exito',
  error: 'ui.paso.resultado.error',
  rechazado: 'ui.paso.resultado.rechazado',
  parcial: 'ui.paso.resultado.parcial',
};

export interface PasoDeTareaProps {
  /** Necesario: enlaza el «por qué lo hice» con su región. */
  id: string;
  /** Qué hizo el agente, en una frase: «Consultó las facturas vencidas». */
  titulo: string;
  resultado: ResultadoDePaso;
  /** Cuándo, ya formateado («hace 2 min»). */
  cuando?: string;
  /** Coste ya formateado («0,0023 €»). Toda acción lo muestra. */
  coste: string;
  /** Nivel de autonomía aplicado, ya formateado («N1 · supervisado»). */
  nivel?: string;
  /** El motivo que anotó el agente. Sin él, el paso lo dice en vez de callarlo. */
  porque?: string | null | undefined;
  /** Pasos que no se explican (recibir el encargo): no repiten «sin motivo». */
  sinNecesitarPorque?: boolean;
  /** Detalle opcional bajo el título (la clase de acción, por ejemplo). */
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * Un paso del agente en una tarea: lo que hizo, con su coste, su nivel de
 * autonomía y el «por qué lo hice». El resultado se dice con palabras, no solo con
 * el color (ADR-020).
 */
export function PasoDeTarea({
  id,
  titulo,
  resultado,
  cuando,
  coste,
  nivel,
  porque,
  sinNecesitarPorque = false,
  children,
  className,
  ...resto
}: PasoDeTareaProps) {
  const t = useTraduccion();
  return (
    <li
      className={cn(TEMA.superficie.tarjeta, 'flex flex-col gap-2 p-4', className)}
      data-resultado={resultado}
      data-testid={resto['data-testid']}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cn(TEMA.texto.titulo, 'text-base')}>{titulo}</p>
        {cuando ? <span className={cn(TEMA.texto.apagado, 'text-xs')}>{cuando}</span> : null}
      </div>
      {children ? <div className={cn(TEMA.texto.cuerpo, 'text-sm')}>{children}</div> : null}
      <div className="flex flex-wrap gap-2">
        <Insignia
          etiqueta={t('ui.paso.etiqueta.resultado')}
          valor={t(CLAVE_DE_RESULTADO[resultado])}
          tono={TONO[resultado]}
        />
        {nivel ? <Insignia etiqueta={t('ui.paso.etiqueta.nivel')} valor={nivel} /> : null}
        <Insignia etiqueta={t('ui.paso.etiqueta.coste')} valor={coste} />
      </div>
      {porque ? (
        <Porque id={id}>{porque}</Porque>
      ) : sinNecesitarPorque ? null : (
        <p className={cn(TEMA.texto.apagado, 'text-xs')}>{t('ui.paso.sinPorque')}</p>
      )}
    </li>
  );
}

export interface ListaDePasosProps {
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/** Los pasos de una tarea, en el orden en que ocurrieron. */
export function ListaDePasos({ children, className, ...resto }: ListaDePasosProps) {
  const t = useTraduccion();
  return (
    <ol
      aria-label={t('ui.paso.lista')}
      className={cn('flex flex-col gap-3', className)}
      data-testid={resto['data-testid']}
    >
      {children}
    </ol>
  );
}
