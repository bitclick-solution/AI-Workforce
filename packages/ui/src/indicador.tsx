import { cn } from './cn';
import { TEMA } from './tema';

export type TonoDeIndicador = 'neutro' | 'exito' | 'aviso' | 'peligro';

export interface IndicadorProps {
  etiqueta: string;
  valor: string;
  ayuda?: string;
  tono?: TonoDeIndicador;
  className?: string;
  'data-testid'?: string;
}

/** Dato destacado con su etiqueta: el número grande de las fichas del panel. */
export function Indicador({
  etiqueta,
  valor,
  ayuda,
  tono = 'neutro',
  className,
  ...resto
}: IndicadorProps) {
  return (
    <div
      className={cn(TEMA.superficie.tarjeta, 'p-4', className)}
      data-testid={resto['data-testid']}
    >
      <p className={TEMA.texto.etiqueta}>{etiqueta}</p>
      <p className={cn(TEMA.texto.titulo, TEMA.indicador[tono], 'mt-1 text-2xl')}>{valor}</p>
      {ayuda ? <p className={cn(TEMA.texto.apagado, 'mt-1 text-xs')}>{ayuda}</p> : null}
    </div>
  );
}
