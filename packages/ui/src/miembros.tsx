'use client';

import { useId, useState, type ReactNode } from 'react';

import type { ColorDeAvatar } from './avatar';
import { cn } from './cn';
import { useTraduccion, type ClaveDeTexto } from './i18n';
import {
  AvatarConPresencia,
  EtiquetaIA,
  estadoParaTipo,
  textoDePresencia,
  type EstadoDePresencia,
  type TipoDeMiembro,
} from './presencia';
import { TEMA } from './tema';

/** Lo que la interfaz necesita de un miembro para pintarlo. Sin lógica de negocio. */
export interface MiembroVisible {
  id: string;
  tipo: TipoDeMiembro;
  nombre: string;
  estado: EstadoDePresencia;
  /** Equipo, puesto o «eres tú»: va delante del estado. */
  contexto?: string;
  /** Cuánto hace o qué hace: va detrás del estado («15 min»). */
  detalle?: string;
  color?: ColorDeAvatar;
}

export type FiltroDeMiembros = 'todos' | 'sala' | 'inactivos' | 'anadidos';

export const FILTROS_DE_MIEMBROS: readonly FiltroDeMiembros[] = [
  'todos',
  'sala',
  'inactivos',
  'anadidos',
];

const CLAVE_DE_FILTRO: Record<FiltroDeMiembros, ClaveDeTexto> = {
  todos: 'ui.miembros.filtro.todos',
  sala: 'ui.miembros.filtro.sala',
  inactivos: 'ui.miembros.filtro.inactivos',
  anadidos: 'ui.miembros.filtro.anadidos',
};

/**
 * Filtro al que pertenece cada estado. «En pausa» cae en Inactivos: el agente
 * no trabaja hasta que vuelva (decisión de la especificación de Sala v1).
 */
export function filtroDeEstado(estado: EstadoDePresencia): Exclude<FiltroDeMiembros, 'todos'> {
  switch (estado) {
    case 'inactivo':
    case 'en-pausa':
      return 'inactivos';
    case 'anadido':
      return 'anadidos';
    default:
      return 'sala';
  }
}

export function filtrarMiembros(
  miembros: readonly MiembroVisible[],
  filtro: FiltroDeMiembros,
): MiembroVisible[] {
  if (filtro === 'todos') return [...miembros];
  return miembros.filter(
    (miembro) => filtroDeEstado(estadoParaTipo(miembro.estado, miembro.tipo)) === filtro,
  );
}

/** Segunda línea de la fila: contexto, estado y detalle, siempre en texto. */
export function lineaDeEstado(
  textoEstado: string,
  contexto: string | undefined,
  detalle: string | undefined,
): string {
  return [contexto, textoEstado, detalle].filter(Boolean).join(' · ');
}

export interface FilaDeMiembroProps {
  miembro: MiembroVisible;
  className?: string;
}

/**
 * Una persona o un agente con su estado. El avatar no se lee (el texto ya dice
 * nombre y estado) para que el lector de pantalla no lo repita.
 */
export function FilaDeMiembro({ miembro, className }: FilaDeMiembroProps) {
  const t = useTraduccion();
  const estado = estadoParaTipo(miembro.estado, miembro.tipo);
  const tono =
    estado === 'escribiendo' || estado === 'te-necesita'
      ? TEMA.miembro.detalleEstado[estado]
      : TEMA.miembro.detalleEstado.neutro;
  return (
    <div
      className={cn(TEMA.miembro.fila, className)}
      data-testid={`miembro-${miembro.id}`}
      data-estado={estado}
    >
      <span aria-hidden="true" className="inline-flex">
        <AvatarConPresencia
          tipo={miembro.tipo}
          nombre={miembro.nombre}
          estado={estado}
          tamano="pequeno"
          {...(miembro.color ? { color: miembro.color } : {})}
        />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={TEMA.miembro.nombre}>{miembro.nombre}</span>
          {miembro.tipo === 'agente' ? <EtiquetaIA /> : null}
        </span>
        <span className={cn(TEMA.miembro.detalle, tono)}>
          {lineaDeEstado(textoDePresencia(t, estado), miembro.contexto, miembro.detalle)}
        </span>
      </span>
    </div>
  );
}

interface GrupoDeMiembros {
  clave: string;
  titulo: string;
  miembros: MiembroVisible[];
}

export interface PanelDeMiembrosProps {
  miembros: readonly MiembroVisible[];
  /** Escritorio (S2): personas y agentes. Móvil (S4): en la sala, inactivos y añadidos. */
  agrupar?: 'tipo' | 'estado';
  /** Muestra los filtros Todos, En la sala, Inactivos y Añadidos. */
  conFiltros?: boolean;
  filtroInicial?: FiltroDeMiembros;
  /** Botones junto al título, como «Ocultar». */
  acciones?: ReactNode;
  /** Sin título propio cuando el contenedor ya lo pone (la hoja móvil). */
  sinTitulo?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Miembros de una sala con su presencia, agrupados y filtrables. */
export function PanelDeMiembros({
  miembros,
  agrupar = 'tipo',
  conFiltros = true,
  filtroInicial = 'todos',
  acciones,
  sinTitulo = false,
  className,
  ...resto
}: PanelDeMiembrosProps) {
  const t = useTraduccion();
  const id = useId();
  const [filtro, establecerFiltro] = useState<FiltroDeMiembros>(filtroInicial);
  const visibles = filtrarMiembros(miembros, conFiltros ? filtro : 'todos');

  const grupos: GrupoDeMiembros[] =
    agrupar === 'tipo'
      ? [
          { clave: 'persona', titulo: 'ui.miembros.personas' as const },
          { clave: 'agente', titulo: 'ui.miembros.agentes' as const },
        ].map(({ clave, titulo }) => {
          const deEsteTipo = visibles.filter((miembro) => miembro.tipo === clave);
          return { clave, titulo: t(titulo, { n: deEsteTipo.length }), miembros: deEsteTipo };
        })
      : (['sala', 'inactivos', 'anadidos'] as const).map((clave) => {
          const deEsteFiltro = filtrarMiembros(visibles, clave);
          return {
            clave,
            titulo: `${t(CLAVE_DE_FILTRO[clave])} · ${deEsteFiltro.length}`,
            miembros: deEsteFiltro,
          };
        });

  return (
    <section
      aria-labelledby={sinTitulo ? undefined : `${id}-titulo`}
      aria-label={sinTitulo ? t('ui.miembros.titulo', { total: miembros.length }) : undefined}
      data-testid={resto['data-testid']}
      className={cn(TEMA.panelDeMiembros.contenedor, className)}
    >
      {sinTitulo ? null : (
        <div className="flex items-center justify-between gap-2">
          <h2 id={`${id}-titulo`} className={TEMA.panelDeMiembros.titulo}>
            {t('ui.miembros.titulo', { total: miembros.length })}
          </h2>
          {acciones ? <div className="flex items-center gap-1">{acciones}</div> : null}
        </div>
      )}
      {conFiltros ? (
        <div role="group" aria-label={t('ui.miembros.filtros')} className="flex flex-wrap gap-1.5">
          {FILTROS_DE_MIEMBROS.map((opcion) => (
            <button
              key={opcion}
              type="button"
              aria-pressed={filtro === opcion}
              data-testid={`filtro-${opcion}`}
              onClick={() => {
                establecerFiltro(opcion);
              }}
              className={cn(
                TEMA.panelDeMiembros.filtro,
                TEMA.foco,
                filtro === opcion
                  ? TEMA.panelDeMiembros.filtroActivo
                  : TEMA.panelDeMiembros.filtroInactivo,
              )}
            >
              {t(CLAVE_DE_FILTRO[opcion])}
            </button>
          ))}
        </div>
      ) : null}
      {visibles.length === 0 ? (
        <p role="status" className={TEMA.texto.apagado + ' text-sm'}>
          {t('ui.miembros.vacio')}
        </p>
      ) : (
        grupos
          .filter((grupo) => grupo.miembros.length > 0)
          .map((grupo) => (
            <div key={grupo.clave} className="flex flex-col gap-1">
              <h3 id={`${id}-${grupo.clave}`} className={TEMA.panelDeMiembros.grupo}>
                {grupo.titulo}
              </h3>
              <ul aria-labelledby={`${id}-${grupo.clave}`} className="flex flex-col">
                {grupo.miembros.map((miembro) => (
                  <li key={miembro.id}>
                    <FilaDeMiembro miembro={miembro} />
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
    </section>
  );
}
