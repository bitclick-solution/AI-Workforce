'use client';

import { cn } from './cn';
import type { MiembroVisible } from './miembros';
import { AvatarConPresencia } from './presencia';
import { TEMA } from './tema';

export interface FilaDePresenciaProps {
  miembros: readonly MiembroVisible[];
  /** «5 en la sala · 1 inactivo · 3 añadidos»: la aplicación lo redacta. */
  resumen: string;
  /** Abre la hoja de miembros. */
  alAbrir: () => void;
  /** Nombre accesible del botón, que incluye el resumen. */
  etiqueta: string;
  /** Avatares que caben antes de cortar. */
  maximo?: number;
  className?: string;
}

/**
 * Fila de presencia bajo la cabecera del móvil (S4). Todo es un único botón de
 * al menos 44 px que abre la hoja de miembros; cada avatar lleva su estado en
 * el nombre accesible y el resumen se lee en texto.
 */
export function FilaDePresencia({
  miembros,
  resumen,
  alAbrir,
  etiqueta,
  maximo = 8,
  className,
}: FilaDePresenciaProps) {
  return (
    <button
      type="button"
      onClick={alAbrir}
      aria-label={etiqueta}
      data-testid="fila-de-presencia"
      className={cn(TEMA.filaDePresencia.contenedor, TEMA.foco, 'min-h-11', className)}
    >
      <span className="flex shrink-0 items-center gap-2" aria-hidden="true">
        {miembros.slice(0, maximo).map((miembro) => (
          <AvatarConPresencia
            key={miembro.id}
            tipo={miembro.tipo}
            nombre={miembro.nombre}
            estado={miembro.estado}
            tamano="pequeno"
            {...(miembro.color ? { color: miembro.color } : {})}
          />
        ))}
      </span>
      <span aria-hidden="true" className={cn(TEMA.filaDePresencia.resumen, 'truncate')}>
        {resumen}
      </span>
    </button>
  );
}
