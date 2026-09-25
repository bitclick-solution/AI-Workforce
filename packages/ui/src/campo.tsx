'use client';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TEMA } from './tema';

export interface CampoProps {
  /** Necesario: enlaza etiqueta, ayuda y error con el control. */
  id: string;
  etiqueta: string;
  valor: string;
  onCambio: (valor: string) => void;
  multilinea?: boolean;
  filas?: number;
  marcador?: string;
  ayuda?: string;
  error?: string;
  opcional?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Campo de texto de una o varias líneas. La etiqueta es siempre visible: un
 * marcador de posición no es una etiqueta y desaparece al escribir.
 */
export function Campo({
  id,
  etiqueta,
  valor,
  onCambio,
  multilinea = false,
  filas = 4,
  marcador,
  ayuda,
  error,
  opcional = false,
  className,
  ...resto
}: CampoProps) {
  const t = useTraduccion();
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const descritoPor = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ');

  const comunes = {
    id,
    value: valor,
    placeholder: marcador,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': descritoPor === '' ? undefined : descritoPor,
    'data-testid': resto['data-testid'],
    className: cn(TEMA.campo.control, error && TEMA.campo.controlConError),
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={TEMA.campo.etiqueta}>
        {etiqueta}
        {opcional ? (
          <span className={cn(TEMA.texto.apagado, 'ml-1 font-normal')}>
            ({t('ui.campo.opcional')})
          </span>
        ) : null}
      </label>
      {multilinea ? (
        <textarea {...comunes} rows={filas} onChange={(evento) => onCambio(evento.target.value)} />
      ) : (
        <input {...comunes} type="text" onChange={(evento) => onCambio(evento.target.value)} />
      )}
      {ayuda ? (
        <p id={idAyuda} className={cn(TEMA.texto.apagado, 'text-xs')}>
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} className={TEMA.campo.error}>
          {t('ui.campo.error')}: {error}
        </p>
      ) : null}
    </div>
  );
}
