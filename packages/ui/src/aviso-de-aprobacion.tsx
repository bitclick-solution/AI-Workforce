'use client';

import type { ReactNode } from 'react';

import { Aviso } from './aviso';
import { Boton } from './boton';
import { useTraduccion } from './i18n';

export interface AvisoDeAprobacionProps {
  titulo: string;
  children?: ReactNode;
  /** Quién lo pide, normalmente un `AvatarDeAgente` junto a su nombre. */
  quienLoPide?: ReactNode;
  alAprobar: () => void;
  alRechazar?: () => void;
  aprobando?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Aviso que «necesita a una persona» con la aprobación en línea: siempre lleva
 * el botón Aprobar, y Rechazar cuando hay una decisión alternativa.
 */
export function AvisoDeAprobacion({
  titulo,
  children,
  quienLoPide,
  alAprobar,
  alRechazar,
  aprobando = false,
  className,
  ...resto
}: AvisoDeAprobacionProps) {
  const t = useTraduccion();
  return (
    <Aviso
      tipo="necesita-persona"
      titulo={titulo}
      {...(className !== undefined ? { className } : {})}
      {...(resto['data-testid'] !== undefined ? { 'data-testid': resto['data-testid'] } : {})}
      accion={
        <>
          <Boton tono="primario" cargando={aprobando} onClick={alAprobar}>
            {t('ui.aviso.aprobar')}
          </Boton>
          {alRechazar ? (
            <Boton tono="secundario" disabled={aprobando} onClick={alRechazar}>
              {t('ui.aviso.rechazar')}
            </Boton>
          ) : null}
        </>
      }
    >
      {quienLoPide ? <div className="mb-2 flex items-center gap-2">{quienLoPide}</div> : null}
      {children}
    </Aviso>
  );
}
