'use client';

import { useId, type MouseEvent } from 'react';

import { cn } from './cn';
import { useTraduccion, type Traductor } from './i18n';
import { TEMA } from './tema';

export interface SalaNavegable {
  id: string;
  nombre: string;
  sinLeer: number;
  menciones: number;
}

export interface NavegacionDeSalasProps {
  salas: readonly SalaNavegable[];
  /** Sala abierta: se marca con `aria-current="page"`. */
  actual?: string;
  /** Dirección de cada sala, para que el enlace funcione sin JavaScript. */
  hrefDe: (id: string) => string;
  /** Si se pasa, el clic no navega y la aplicación cambia de sala en el sitio. */
  alElegir?: (id: string) => void;
  className?: string;
  'data-testid'?: string;
}

/** Texto accesible de los contadores: «2 menciones, 5 mensajes sin leer». */
export function textoDeContadores(t: Traductor, sala: SalaNavegable): string {
  const partes: string[] = [];
  if (sala.menciones > 0) {
    partes.push(
      sala.menciones === 1
        ? t('ui.salas.menciones.una')
        : t('ui.salas.menciones.varias', { n: sala.menciones }),
    );
  }
  if (sala.sinLeer > 0) {
    partes.push(
      sala.sinLeer === 1
        ? t('ui.salas.sinLeer.uno')
        : t('ui.salas.sinLeer.varios', { n: sala.sinLeer }),
    );
  }
  return partes.join(', ');
}

/**
 * «Salas» como apartado de la navegación del panel (S2) o del cajón móvil (S4).
 * Una sala con mensajes sin leer va en negrita; las menciones llevan su número.
 * Los dos contadores se leen en texto, no solo con el peso o el color.
 */
export function NavegacionDeSalas({
  salas,
  actual,
  hrefDe,
  alElegir,
  className,
  ...resto
}: NavegacionDeSalasProps) {
  const t = useTraduccion();
  const id = useId();
  return (
    <nav
      aria-labelledby={`${id}-titulo`}
      data-testid={resto['data-testid']}
      className={cn('flex flex-col gap-1', className)}
    >
      <h2 id={`${id}-titulo`} className={TEMA.navegacionDeSalas.titulo}>
        {t('ui.salas.titulo')}
      </h2>
      {salas.length === 0 ? (
        <p className={cn(TEMA.texto.apagado, 'px-3 text-sm')}>{t('ui.salas.vacio')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {salas.map((sala) => {
            const esActual = sala.id === actual;
            const contadores = textoDeContadores(t, sala);
            const clase = esActual
              ? TEMA.navegacionDeSalas.enlaceActual
              : sala.sinLeer > 0 || sala.menciones > 0
                ? TEMA.navegacionDeSalas.enlaceSinLeer
                : TEMA.navegacionDeSalas.enlaceNormal;
            return (
              <li key={sala.id}>
                <a
                  href={hrefDe(sala.id)}
                  aria-current={esActual ? 'page' : undefined}
                  data-testid={`sala-${sala.id}`}
                  onClick={
                    alElegir
                      ? (evento: MouseEvent<HTMLAnchorElement>) => {
                          evento.preventDefault();
                          alElegir(sala.id);
                        }
                      : undefined
                  }
                  className={cn(TEMA.navegacionDeSalas.enlace, TEMA.foco, clase)}
                >
                  <span aria-hidden="true" className={TEMA.navegacionDeSalas.almohadilla}>
                    #
                  </span>
                  <span className="truncate">{sala.nombre}</span>
                  {contadores ? <span className="sr-only">, {contadores}</span> : null}
                  {sala.menciones > 0 ? (
                    <span aria-hidden="true" className={TEMA.navegacionDeSalas.menciones}>
                      {sala.menciones}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
