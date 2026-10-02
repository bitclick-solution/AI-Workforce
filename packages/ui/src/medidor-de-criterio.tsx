'use client';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { Insignia } from './insignia';
import { TEMA } from './tema';

export interface MedidorDeCriterioProps {
  /** Qué se mide: «Acciones», «Aprobadas sin cambios». */
  etiqueta: string;
  /** Valor actual ya formateado («12 de 30», «87 %»). `null`: aún no hay datos. */
  valor: string | null;
  /** Lo que se pide ya formateado («al menos 30»). */
  requerido: string;
  /** Avance entre 0 y 1. `null`: aún no hay datos. */
  progreso: number | null;
  cumplido: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Un criterio de ascenso (ADR-005) con su valor actual. Dice en palabras si se
 * cumple o falta —el color solo refuerza— y con «Sin datos todavía» no inventa un
 * cero: callar un dato y tenerlo a cero no es lo mismo.
 */
export function MedidorDeCriterio({
  etiqueta,
  valor,
  requerido,
  progreso,
  cumplido,
  className,
  ...resto
}: MedidorDeCriterioProps) {
  const t = useTraduccion();
  const fraccion = progreso === null ? 0 : Math.min(1, Math.max(0, progreso));
  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid={resto['data-testid']}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={cn(TEMA.texto.cuerpo, 'text-sm font-medium')}>{etiqueta}</span>
        <Insignia
          etiqueta={requerido}
          valor={cumplido ? t('ui.medidor.cumplido') : t('ui.medidor.pendiente')}
          tono={cumplido ? 'exito' : 'neutro'}
        />
      </div>
      <div
        role="meter"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraccion * 100)}
        aria-valuetext={valor ?? t('ui.medidor.sinDatos')}
        className={TEMA.medidor.pista}
      >
        <span className={TEMA.medidor.relleno} style={{ width: `${fraccion * 100}%` }} />
      </div>
      <p className={cn(TEMA.texto.apagado, 'text-xs')}>{valor ?? t('ui.medidor.sinDatos')}</p>
    </div>
  );
}
