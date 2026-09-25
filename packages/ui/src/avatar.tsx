'use client';

import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion, type ClaveDeTexto } from './i18n';
import { TEMA } from './tema';

export type GestoDeAgente = 'sereno' | 'alegre' | 'concentrado';
export type ColorDeAvatar = 'melocoton' | 'menta' | 'cielo' | 'lila' | 'limon' | 'rosa';
export type PuestoConEmblema =
  'cobros' | 'conciliacion' | 'prevision' | 'moderador' | 'director-ia';
export type EstadoDeAvatar = 'te-necesita' | 'trabajando' | 'en-espera';
export type TamanoDeAvatar = 'pequeno' | 'base' | 'grande';

const CLAVE_DE_ESTADO: Record<EstadoDeAvatar, ClaveDeTexto> = {
  'te-necesita': 'ui.avatar.teNecesita',
  trabajando: 'ui.avatar.trabajando',
  'en-espera': 'ui.avatar.enEspera',
};

const COLOR_POR_DEFECTO: ColorDeAvatar = 'lila';

function CaraDeAgente({ gesto }: { gesto: GestoDeAgente }) {
  const boca: Record<GestoDeAgente, ReactNode> = {
    sereno: <line x1="18" y1="30" x2="30" y2="30" strokeLinecap="round" />,
    alegre: <path d="M17 28 Q24 35 31 28" fill="none" strokeLinecap="round" />,
    concentrado: <line x1="19" y1="31" x2="29" y2="31" strokeLinecap="round" strokeWidth="2.5" />,
  };
  const cejas: ReactNode = gesto === 'concentrado' && (
    <>
      <line x1="14" y1="16" x2="20" y2="18" strokeLinecap="round" />
      <line x1="34" y1="16" x2="28" y2="18" strokeLinecap="round" />
    </>
  );
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-full w-full">
      <g fill="none" stroke="var(--color-avatar-tinta)" strokeWidth="2">
        {cejas}
        <circle cx="17" cy="22" r="2" fill="var(--color-avatar-tinta)" stroke="none" />
        <circle cx="31" cy="22" r="2" fill="var(--color-avatar-tinta)" stroke="none" />
        {boca[gesto]}
      </g>
    </svg>
  );
}

const EMBLEMA_POR_PUESTO: Record<PuestoConEmblema, ReactNode> = {
  cobros: (
    <text
      x="8"
      y="11.5"
      textAnchor="middle"
      fontSize="9"
      fontWeight="700"
      fill="var(--color-avatar-tinta)"
    >
      €
    </text>
  ),
  conciliacion: (
    <>
      <rect x="3" y="4" width="4.5" height="4.5" fill="var(--color-avatar-tinta)" />
      <rect x="9" y="9" width="4.5" height="4.5" fill="var(--color-avatar-tinta)" />
    </>
  ),
  prevision: (
    <>
      <rect x="3" y="9" width="2.4" height="5" fill="var(--color-avatar-tinta)" />
      <rect x="6.8" y="6" width="2.4" height="8" fill="var(--color-avatar-tinta)" />
      <rect x="10.6" y="3" width="2.4" height="11" fill="var(--color-avatar-tinta)" />
    </>
  ),
  moderador: (
    <>
      <circle cx="4.5" cy="8" r="1.6" fill="var(--color-avatar-tinta)" />
      <circle cx="8" cy="8" r="1.6" fill="var(--color-avatar-tinta)" />
      <circle cx="11.5" cy="8" r="1.6" fill="var(--color-avatar-tinta)" />
    </>
  ),
  'director-ia': (
    <rect
      x="4.5"
      y="1.5"
      width="8"
      height="8"
      transform="rotate(45 8 8)"
      fill="var(--color-avatar-tinta)"
    />
  ),
};

function EmblemaDePuesto({ puesto }: { puesto: PuestoConEmblema }) {
  return (
    <span className={TEMA.avatar.emblema} aria-hidden="true">
      <svg viewBox="0 0 16 16" className="h-3 w-3">
        {EMBLEMA_POR_PUESTO[puesto]}
      </svg>
    </span>
  );
}

function AnilloDeEstado({ estado }: { estado: EstadoDeAvatar | undefined }) {
  const t = useTraduccion();
  if (!estado) return null;
  const etiqueta = t(CLAVE_DE_ESTADO[estado]);
  if (estado === 'trabajando') {
    return (
      <>
        <span className="sr-only">{etiqueta}</span>
        <span className={TEMA.avatar.trabajando} aria-hidden="true" />
      </>
    );
  }
  return <span className="sr-only">{etiqueta}</span>;
}

export interface AvatarDeAgenteProps {
  /** Nombre del agente: es su nombre accesible. */
  nombre: string;
  gesto?: GestoDeAgente;
  color?: ColorDeAvatar;
  puesto?: PuestoConEmblema;
  estado?: EstadoDeAvatar;
  tamano?: TamanoDeAvatar;
  className?: string;
  'data-testid'?: string;
}

/** Avatar del agente: cuadrado redondeado, cara con gesto, color pastel y emblema del puesto. */
export function AvatarDeAgente({
  nombre,
  gesto = 'sereno',
  color = COLOR_POR_DEFECTO,
  puesto,
  estado,
  tamano = 'base',
  className,
  ...resto
}: AvatarDeAgenteProps) {
  return (
    <span
      role="img"
      aria-label={nombre}
      data-testid={resto['data-testid']}
      className={cn(
        TEMA.avatar.base,
        TEMA.avatar.agente,
        TEMA.avatar.color[color],
        TEMA.avatar.tamano[tamano],
        estado && estado !== 'trabajando' && TEMA.avatar.estado[estado],
        className,
      )}
    >
      <CaraDeAgente gesto={gesto} />
      {puesto ? <EmblemaDePuesto puesto={puesto} /> : null}
      <AnilloDeEstado estado={estado} />
    </span>
  );
}

function inicialesDeNombre(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return partes
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');
}

function Silueta() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-3/5 w-3/5">
      <circle cx="24" cy="18" r="8" fill="currentColor" />
      <path d="M8 40c2-10 8-15 16-15s14 5 16 15Z" fill="currentColor" />
    </svg>
  );
}

export interface AvatarDePersonaProps {
  /** Nombre de la persona: es su nombre accesible y el origen de las iniciales. */
  nombre: string;
  /** Sustituye a las iniciales calculadas del nombre. */
  iniciales?: string;
  estado?: EstadoDeAvatar;
  tamano?: TamanoDeAvatar;
  className?: string;
  'data-testid'?: string;
}

/** Avatar de una persona: círculo con sus iniciales o, si no hay, una silueta. */
export function AvatarDePersona({
  nombre,
  iniciales,
  estado,
  tamano = 'base',
  className,
  ...resto
}: AvatarDePersonaProps) {
  const t = useTraduccion();
  const texto = iniciales ?? inicialesDeNombre(nombre);
  const etiquetaAccesible = nombre.trim() === '' ? t('ui.avatar.personaSinNombre') : nombre;
  return (
    <span
      role="img"
      aria-label={etiquetaAccesible}
      data-testid={resto['data-testid']}
      className={cn(
        TEMA.avatar.base,
        TEMA.avatar.persona,
        TEMA.avatar.tamano[tamano],
        estado && estado !== 'trabajando' && TEMA.avatar.estado[estado],
        className,
      )}
    >
      {texto ? texto : <Silueta />}
      <AnilloDeEstado estado={estado} />
    </span>
  );
}
