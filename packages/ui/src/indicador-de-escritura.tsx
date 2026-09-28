'use client';

import { cn } from './cn';
import { useTraduccion, type Traductor } from './i18n';
import { TEMA } from './tema';

/** «Cobros está escribiendo…», «Cobros y Conciliación están…», «Varios miembros…». */
export function textoDeEscritura(t: Traductor, nombres: readonly string[]): string {
  const [primero, segundo] = nombres;
  if (primero === undefined) return '';
  if (segundo === undefined) return t('ui.escritura.uno', { a: primero });
  if (nombres.length === 2) return t('ui.escritura.dos', { a: primero, b: segundo });
  return t('ui.escritura.varios');
}

export interface IndicadorDeEscrituraProps {
  /** Quién escribe ahora en la sala, sin contar a quien mira. */
  nombres: readonly string[];
  className?: string;
}

/**
 * Indicador sobre el compositor. La región `aria-live` existe siempre, aunque
 * nadie escriba, para que el lector anuncie el cambio cuando aparece el texto.
 */
export function IndicadorDeEscritura({ nombres, className }: IndicadorDeEscrituraProps) {
  const t = useTraduccion();
  const texto = textoDeEscritura(t, nombres);
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-testid="indicador-de-escritura"
      className={cn(TEMA.escritura.contenedor, className)}
    >
      {texto ? (
        <>
          <span aria-hidden="true" className="inline-flex gap-0.5">
            <span className={TEMA.escritura.punto} />
            <span className={cn(TEMA.escritura.punto, '[animation-delay:.2s]')} />
            <span className={cn(TEMA.escritura.punto, '[animation-delay:.4s]')} />
          </span>
          <span>{texto}</span>
        </>
      ) : null}
    </div>
  );
}
