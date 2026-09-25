'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion, type ClaveDeTexto } from './i18n';
import { TEMA } from './tema';

export type TipoDeAviso = 'vacio' | 'error' | 'necesita-persona' | 'informacion';

interface AvisoBase {
  titulo: string;
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * Los tres estados que esta rebanada diseña antes que el camino feliz exigen una
 * acción siguiente: una pantalla que dice que algo ha fallado y deja a la persona
 * sin salida no es un estado de error, es un callejón.
 */
export type AvisoProps =
  | (AvisoBase & { tipo: 'informacion'; accion?: ReactNode })
  | (AvisoBase & { tipo: 'vacio' | 'error' | 'necesita-persona'; accion: ReactNode });

const CLAVE: Record<TipoDeAviso, ClaveDeTexto> = {
  vacio: 'ui.aviso.vacio',
  error: 'ui.aviso.error',
  'necesita-persona': 'ui.aviso.necesita-persona',
  informacion: 'ui.aviso.informacion',
};

/** `alert` para lo que interrumpe; `status` para lo que solo informa. */
function papel(tipo: TipoDeAviso): 'alert' | 'status' {
  return tipo === 'error' || tipo === 'necesita-persona' ? 'alert' : 'status';
}

/**
 * Aviso de estado. El tipo se comunica también con palabras, nunca solo con el
 * color: la etiqueta de arriba lo dice en texto.
 */
export function Aviso({ tipo, titulo, children, accion, className, ...resto }: AvisoProps) {
  const t = useTraduccion();
  return (
    <section
      role={papel(tipo)}
      aria-label={titulo}
      data-tipo={tipo}
      data-testid={resto['data-testid']}
      className={cn('rounded-xl border p-4 sm:p-5', TEMA.aviso[tipo], className)}
    >
      <p className={TEMA.texto.etiquetaBase}>{t(CLAVE[tipo])}</p>
      <h3 className="mt-1 text-base font-semibold">{titulo}</h3>
      {children ? <div className="mt-2 text-sm">{children}</div> : null}
      {accion ? <div className="mt-4 flex flex-wrap gap-2">{accion}</div> : null}
    </section>
  );
}
