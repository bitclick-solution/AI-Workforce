'use client';

import { AvatarDeAgente, AvatarDePersona, type ColorDeAvatar } from './avatar';
import { cn } from './cn';
import { useTraduccion, type ClaveDeTexto, type Traductor } from './i18n';
import { TEMA } from './tema';

/**
 * Estados de presencia del ADR-022. Los mismos valores que el contrato de la
 * sala (`apps/web/lib/sala-contrato.ts`); se repiten aquí porque este paquete
 * no depende de ninguna aplicación.
 */
export type EstadoDePresencia =
  'en-la-sala' | 'escribiendo' | 'inactivo' | 'anadido' | 'trabajando' | 'te-necesita' | 'en-pausa';

export type TipoDeMiembro = 'persona' | 'agente';

export const ESTADOS_DE_PRESENCIA: readonly EstadoDePresencia[] = [
  'en-la-sala',
  'escribiendo',
  'trabajando',
  'te-necesita',
  'inactivo',
  'anadido',
  'en-pausa',
];

/** Trabajando, te necesita y en pausa solo tienen sentido para un agente. */
export const ESTADOS_SOLO_DE_AGENTE: readonly EstadoDePresencia[] = [
  'trabajando',
  'te-necesita',
  'en-pausa',
];

const CLAVE_DE_PRESENCIA: Record<EstadoDePresencia, ClaveDeTexto> = {
  'en-la-sala': 'ui.presencia.en-la-sala',
  escribiendo: 'ui.presencia.escribiendo',
  inactivo: 'ui.presencia.inactivo',
  anadido: 'ui.presencia.anadido',
  trabajando: 'ui.presencia.trabajando',
  'te-necesita': 'ui.presencia.te-necesita',
  'en-pausa': 'ui.presencia.en-pausa',
};

/**
 * Estado que se pinta para un tipo de miembro. Una persona no puede estar
 * «trabajando», «te necesita» ni «en pausa»: si llega uno de esos, se pinta
 * «en la sala» para no inventar un estado que el ADR-022 no define.
 */
export function estadoParaTipo(estado: EstadoDePresencia, tipo: TipoDeMiembro): EstadoDePresencia {
  if (tipo === 'persona' && ESTADOS_SOLO_DE_AGENTE.includes(estado)) return 'en-la-sala';
  return estado;
}

/** Texto del estado: lo que se lee junto a la marca y lo que oye el lector de pantalla. */
export function textoDePresencia(t: Traductor, estado: EstadoDePresencia): string {
  return t(CLAVE_DE_PRESENCIA[estado]);
}

export type TamanoDeMarca = 'pequeno' | 'base';

export interface MarcaDePresenciaProps {
  estado: EstadoDePresencia;
  tamano?: TamanoDeMarca;
  /** Posiciona la marca en la esquina de un avatar. */
  enAvatar?: boolean;
  className?: string;
}

function Luna() {
  return (
    <svg viewBox="0 0 16 16" className="h-full w-full" aria-hidden="true">
      <path
        d="M14 10.4A6.2 6.2 0 0 1 5.6 2a6.6 6.6 0 1 0 8.4 8.4z"
        fill="var(--color-presencia-inactiva)"
      />
    </svg>
  );
}

function Progreso() {
  return (
    <svg viewBox="0 0 16 16" className="h-full w-full" aria-hidden="true">
      <path
        d="M8 3.5a4.5 4.5 0 1 1-4.5 4.5"
        fill="none"
        stroke="var(--color-superficie)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Exclamacion() {
  return (
    <svg viewBox="0 0 16 16" className="h-full w-full" aria-hidden="true">
      <rect x="7" y="3" width="2.2" height="6.5" rx="1" fill="var(--color-superficie)" />
      <circle cx="8.1" cy="12" r="1.3" fill="var(--color-superficie)" />
    </svg>
  );
}

/**
 * Forma de cada estado (hoja S0 del lienzo): punto lleno, píldora con puntos,
 * luna, aro vacío, arco de progreso, exclamación y pausa. Es decorativa: el
 * texto del estado lo pone siempre quien la usa (`FilaDeMiembro`,
 * `AvatarConPresencia`), así que la marca sola no comunica nada al lector.
 */
export function MarcaDePresencia({
  estado,
  tamano = 'base',
  enAvatar = false,
  className,
}: MarcaDePresenciaProps) {
  return (
    <span
      aria-hidden="true"
      data-forma={estado}
      className={cn(
        TEMA.presencia.marca,
        TEMA.presencia.tamano[tamano],
        TEMA.presencia.forma[estado],
        enAvatar && TEMA.presencia.enAvatar,
        className,
      )}
    >
      {estado === 'escribiendo' ? (
        <>
          <span className={TEMA.presencia.punto} />
          <span className={cn(TEMA.presencia.punto, '[animation-delay:.2s]')} />
          <span className={cn(TEMA.presencia.punto, '[animation-delay:.4s]')} />
        </>
      ) : null}
      {estado === 'inactivo' ? <Luna /> : null}
      {estado === 'trabajando' ? <Progreso /> : null}
      {estado === 'te-necesita' ? <Exclamacion /> : null}
      {estado === 'en-pausa' ? (
        <>
          <span className={TEMA.presencia.barra} />
          <span className={TEMA.presencia.barra} />
        </>
      ) : null}
    </span>
  );
}

/** Etiqueta «IA» de los agentes: se ve y se lee como «Agente de IA». */
export function EtiquetaIA({ className }: { className?: string }) {
  const t = useTraduccion();
  return (
    <span className={cn(TEMA.miembro.etiquetaIA, className)}>
      <span aria-hidden="true">{t('ui.ia.etiqueta')}</span>
      <span className="sr-only">{t('ui.ia.descripcion')}</span>
    </span>
  );
}

export interface AvatarConPresenciaProps {
  tipo: TipoDeMiembro;
  nombre: string;
  estado: EstadoDePresencia;
  /** Agentes: color pastel del avatar. */
  color?: ColorDeAvatar;
  tamano?: 'pequeno' | 'base';
  className?: string;
  'data-testid'?: string;
}

/**
 * Avatar con su marca de presencia en la esquina. El nombre accesible reúne
 * nombre y estado («Cobros, Te necesita»), así que el estado nunca queda solo
 * en la forma ni en el color. «Trabajando» y «te necesita» añaden los anillos
 * de `AvatarDeAgente`; «añadido» atenúa el avatar. Sin emblema de puesto: su
 * esquina es la de la marca de presencia.
 */
export function AvatarConPresencia({
  tipo,
  nombre,
  estado,
  color,
  tamano = 'base',
  className,
  ...resto
}: AvatarConPresenciaProps) {
  const t = useTraduccion();
  const visible = estadoParaTipo(estado, tipo);
  const texto = textoDePresencia(t, visible);
  const tamanoAvatar = tamano === 'pequeno' ? 'pequeno' : 'base';
  const atenuado = visible === 'anadido' && TEMA.presencia.avatarAnadido;
  return (
    <span
      role="img"
      aria-label={`${nombre}, ${texto}`}
      data-estado={visible}
      data-testid={resto['data-testid']}
      className={cn('relative inline-flex shrink-0', className)}
    >
      <span aria-hidden="true" className={cn('inline-flex', atenuado)}>
        {tipo === 'agente' ? (
          <AvatarDeAgente
            nombre={nombre}
            tamano={tamanoAvatar}
            {...(color ? { color } : {})}
            {...(visible === 'trabajando' || visible === 'te-necesita' ? { estado: visible } : {})}
          />
        ) : (
          <AvatarDePersona nombre={nombre} tamano={tamanoAvatar} />
        )}
      </span>
      <MarcaDePresencia estado={visible} enAvatar tamano={tamano} />
    </span>
  );
}
