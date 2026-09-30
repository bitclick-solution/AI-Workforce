'use client';

/**
 * Contenedor de rejilla del inicio (ADR-020): cada persona ordena, estira y oculta
 * los widgets del catálogo cerrado, y esa disposición se conserva entre sesiones.
 *
 * El estado (`DisposicionDeWidget[]`) lo guarda quien usa el componente —normalmente
 * persistido por persona en `apps/api`— y aquí solo vive la rejilla: reordenar,
 * cambiar de tamaño y ocultar son funciones puras (`moverWidget`, `cambiarTamano`,
 * `ocultarWidget`, `mostrarWidget`) que devuelven la disposición siguiente, así que
 * se prueban sin renderizar nada y el componente solo las invoca.
 *
 * Reordenar y estirar se hacen con controles de teclado (botones, no arrastrar):
 * arrastrar con el ratón no tiene equivalente accesible sin más trabajo del que
 * cabe en el catálogo v1, y unos botones con `aria-label` cumplen el criterio de
 * hecho «los widgets se reordenan también sin ratón» desde la primera versión.
 */
import type { ReactNode } from 'react';

import { cn } from './cn';
import { useTraduccion } from './i18n';
import { TarjetaDeWidget } from './tarjeta-de-widget';
import { TEMA } from './tema';

export type TamanoDeWidget = 'pequeno' | 'mediano' | 'grande';

export interface DisposicionDeWidget {
  id: string;
  tamano: TamanoDeWidget;
  oculto: boolean;
}

const ORDEN_DE_TAMANOS: TamanoDeWidget[] = ['pequeno', 'mediano', 'grande'];

/** Disposición inicial: todos los widgets pedidos, visibles, a tamaño mediano. */
export function disposicionPorDefecto(ids: readonly string[]): DisposicionDeWidget[] {
  return ids.map((id) => ({ id, tamano: 'mediano', oculto: false }));
}

/**
 * Completa una disposición guardada con los widgets del catálogo que falten (uno
 * nuevo en el catálogo que la persona no había visto) y quita los que ya no
 * existen (uno que salió del catálogo cerrado). Nunca lanza con datos sueltos:
 * una entrada que no es del catálogo se descarta en vez de romper el panel.
 */
export function normalizarDisposicion(
  guardada: readonly DisposicionDeWidget[],
  idsDelCatalogo: readonly string[],
): DisposicionDeWidget[] {
  const catalogo = new Set(idsDelCatalogo);
  const conocidos = new Set<string>();
  const normalizada: DisposicionDeWidget[] = [];
  for (const entrada of guardada) {
    if (!catalogo.has(entrada.id) || conocidos.has(entrada.id)) continue;
    conocidos.add(entrada.id);
    normalizada.push({
      id: entrada.id,
      tamano: ORDEN_DE_TAMANOS.includes(entrada.tamano) ? entrada.tamano : 'mediano',
      oculto: entrada.oculto === true,
    });
  }
  for (const id of idsDelCatalogo) {
    if (!conocidos.has(id)) normalizada.push({ id, tamano: 'mediano', oculto: false });
  }
  return normalizada;
}

function indiceDe(disposicion: readonly DisposicionDeWidget[], id: string): number {
  return disposicion.findIndex((entrada) => entrada.id === id);
}

/** Sube o baja un widget un puesto en el orden. En el extremo, no hace nada. */
export function moverWidget(
  disposicion: readonly DisposicionDeWidget[],
  id: string,
  direccion: 'arriba' | 'abajo',
): DisposicionDeWidget[] {
  const indice = indiceDe(disposicion, id);
  const destino = direccion === 'arriba' ? indice - 1 : indice + 1;
  if (indice < 0 || destino < 0 || destino >= disposicion.length) return [...disposicion];
  const copia = [...disposicion];
  const [movido] = copia.splice(indice, 1);
  if (!movido) return copia;
  copia.splice(destino, 0, movido);
  return copia;
}

/** Agranda o achica un widget dentro de `pequeño`, `mediano` y `grande`. */
export function cambiarTamano(
  disposicion: readonly DisposicionDeWidget[],
  id: string,
  sentido: 'agrandar' | 'achicar',
): DisposicionDeWidget[] {
  return disposicion.map((entrada) => {
    if (entrada.id !== id) return entrada;
    const posicion = ORDEN_DE_TAMANOS.indexOf(entrada.tamano);
    const siguiente = sentido === 'agrandar' ? posicion + 1 : posicion - 1;
    if (siguiente < 0 || siguiente >= ORDEN_DE_TAMANOS.length) return entrada;
    const tamano = ORDEN_DE_TAMANOS[siguiente];
    return tamano ? { ...entrada, tamano } : entrada;
  });
}

export function ocultarWidget(
  disposicion: readonly DisposicionDeWidget[],
  id: string,
): DisposicionDeWidget[] {
  return disposicion.map((entrada) => (entrada.id === id ? { ...entrada, oculto: true } : entrada));
}

export function mostrarWidget(
  disposicion: readonly DisposicionDeWidget[],
  id: string,
): DisposicionDeWidget[] {
  return disposicion.map((entrada) =>
    entrada.id === id ? { ...entrada, oculto: false } : entrada,
  );
}

export interface DefinicionDeWidget {
  titulo: string;
  descripcion?: string;
  contenido: ReactNode;
}

export interface PanelDeWidgetsProps {
  disposicion: DisposicionDeWidget[];
  /** Definición de cada widget del catálogo cerrado, por `id`. */
  widgets: Record<string, DefinicionDeWidget>;
  onCambiarDisposicion: (siguiente: DisposicionDeWidget[]) => void;
  className?: string;
  'data-testid'?: string;
}

const CLASE_POR_TAMANO: Record<TamanoDeWidget, string> = {
  pequeno: 'sm:col-span-1',
  mediano: 'sm:col-span-2',
  grande: 'sm:col-span-3',
};

/** Rejilla de widgets del inicio: reordenar, estirar y ocultar, todo con teclado. */
export function PanelDeWidgets({
  disposicion,
  widgets,
  onCambiarDisposicion,
  className,
  ...resto
}: PanelDeWidgetsProps) {
  const t = useTraduccion();
  const visibles = disposicion.filter((entrada) => !entrada.oculto && widgets[entrada.id]);
  const ocultos = disposicion.filter((entrada) => entrada.oculto && widgets[entrada.id]);

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid={resto['data-testid']}>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        role="list"
        aria-label={t('ui.panelDeWidgets.rejilla')}
      >
        {visibles.map((entrada, indice) => {
          const widget = widgets[entrada.id];
          if (!widget) return null;
          const esPrimero = indice === 0;
          const esUltimo = indice === visibles.length - 1;
          const esMaximo = entrada.tamano === 'grande';
          const esMinimo = entrada.tamano === 'pequeno';
          return (
            <div
              key={entrada.id}
              role="listitem"
              className={cn(CLASE_POR_TAMANO[entrada.tamano])}
              data-testid={`widget-${entrada.id}`}
              data-tamano={entrada.tamano}
            >
              <TarjetaDeWidget
                titulo={widget.titulo}
                {...(widget.descripcion !== undefined ? { descripcion: widget.descripcion } : {})}
                alQuitar={() => onCambiarDisposicion(ocultarWidget(disposicion, entrada.id))}
                acciones={
                  <>
                    <button
                      type="button"
                      className={cn(TEMA.widget.boton, TEMA.foco)}
                      disabled={esPrimero}
                      aria-label={t('ui.panelDeWidgets.subir', { titulo: widget.titulo })}
                      onClick={() =>
                        onCambiarDisposicion(moverWidget(disposicion, entrada.id, 'arriba'))
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={cn(TEMA.widget.boton, TEMA.foco)}
                      disabled={esUltimo}
                      aria-label={t('ui.panelDeWidgets.bajar', { titulo: widget.titulo })}
                      onClick={() =>
                        onCambiarDisposicion(moverWidget(disposicion, entrada.id, 'abajo'))
                      }
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className={cn(TEMA.widget.boton, TEMA.foco)}
                      disabled={esMinimo}
                      aria-label={t('ui.panelDeWidgets.achicar', { titulo: widget.titulo })}
                      onClick={() =>
                        onCambiarDisposicion(cambiarTamano(disposicion, entrada.id, 'achicar'))
                      }
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className={cn(TEMA.widget.boton, TEMA.foco)}
                      disabled={esMaximo}
                      aria-label={t('ui.panelDeWidgets.agrandar', { titulo: widget.titulo })}
                      onClick={() =>
                        onCambiarDisposicion(cambiarTamano(disposicion, entrada.id, 'agrandar'))
                      }
                    >
                      +
                    </button>
                  </>
                }
              >
                {widget.contenido}
              </TarjetaDeWidget>
            </div>
          );
        })}
      </div>

      {ocultos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="panel-de-widgets-ocultos">
          <span className={TEMA.texto.apagado}>{t('ui.panelDeWidgets.ocultos')}</span>
          {ocultos.map((entrada) => {
            const widget = widgets[entrada.id];
            if (!widget) return null;
            return (
              <button
                key={entrada.id}
                type="button"
                className={cn(TEMA.insignia.base, TEMA.insignia.neutro, TEMA.foco)}
                onClick={() => onCambiarDisposicion(mostrarWidget(disposicion, entrada.id))}
              >
                {t('ui.panelDeWidgets.mostrar', { titulo: widget.titulo })}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
