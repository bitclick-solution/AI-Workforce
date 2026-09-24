import { cn } from './cn';
import { TEMA } from './tema';

export type TonoDeInsignia = 'neutro' | 'exito' | 'aviso' | 'peligro';

export interface InsigniaProps {
  /** Qué se mide: «Nivel», «Coste», «Estado». Siempre visible. */
  etiqueta: string;
  valor: string;
  tono?: TonoDeInsignia;
  className?: string;
  'data-testid'?: string;
}

/**
 * Dato corto con su etiqueta. El significado viaja en el texto y no en el color,
 * porque el nivel de autonomía y el coste tienen que leerse en gris.
 */
export function Insignia({ etiqueta, valor, tono = 'neutro', className, ...resto }: InsigniaProps) {
  return (
    <span
      className={cn(TEMA.insignia.base, TEMA.insignia[tono], className)}
      data-testid={resto['data-testid']}
    >
      <span className="opacity-70">{etiqueta}:</span>
      <span className="font-semibold">{valor}</span>
    </span>
  );
}
