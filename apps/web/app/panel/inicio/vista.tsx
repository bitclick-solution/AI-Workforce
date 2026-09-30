'use client';

/**
 * Inicio del panel: rejilla de widgets a la izquierda y avisos a la derecha
 * (ADR-020). Los agentes se leen de `/api/inicio/agentes` y se refrescan en
 * tiempo real reutilizando la conexión de Centrifugo de Sala v1
 * (`suscribirseAAgentesEnVivo`, en `lib/inicio.ts`), con un refresco de
 * respaldo cada `INTERVALO_RESPALDO_MS` mientras no exista el aviso de tarea
 * completada (ver el comentario de esa función).
 */
import {
  AvisoDeAprobacion,
  ListaDeAvisos,
  PanelDeWidgets,
  cn,
  disposicionPorDefecto,
  normalizarDisposicion,
  TEMA,
  type DisposicionDeWidget,
} from '@aiw/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { guardarDisposicionPanel, leerDisposicionPanel } from '../../../lib/cliente-perfil';
import {
  INTERVALO_RESPALDO_MS,
  decidirAviso,
  encargarTarea,
  leerAgentes,
  leerAvisos,
  suscribirseAAgentesEnVivo,
  type AgenteDelInicio,
  type AvisoDelInicio,
} from '../../../lib/inicio';
import { crearFuente } from '../../../lib/sala-fuente';
import {
  WidgetContador,
  WidgetFicha,
  WidgetLoUltimo,
  WidgetSaludo,
  WidgetTuEquipo,
  WidgetVencidoPorAntiguedad,
} from './widgets';

/** Catálogo cerrado v1 (criterio de hecho 2). El orden aquí es el orden por defecto. */
const CATALOGO = ['saludo', 'contador', 'ficha', 'equipo', 'vencido', 'ultimo'] as const;

interface DatosDelContador {
  tareas: number;
  costeModelosEuros: number;
}

export interface PropsDeLaVista {
  nombre: string;
}

export function VistaDelInicio({ nombre }: PropsDeLaVista) {
  const [agentes, setAgentes] = useState<AgenteDelInicio[]>([]);
  const [avisos, setAvisos] = useState<AvisoDelInicio[]>([]);
  const [contador, setContador] = useState<DatosDelContador | undefined>(undefined);
  const [cargandoContador, setCargandoContador] = useState(true);
  const [disposicion, setDisposicion] = useState<DisposicionDeWidget[]>(() =>
    disposicionPorDefecto(CATALOGO),
  );
  const [decidiendo, setDecidiendo] = useState<string | undefined>(undefined);
  const [errorGeneral, setErrorGeneral] = useState<string | undefined>(undefined);
  const vivo = useRef(true);

  const refrescarAgentes = useCallback(async () => {
    try {
      const siguiente = await leerAgentes();
      if (vivo.current) setAgentes(siguiente);
    } catch {
      // El respaldo de consulta periódica ya reintenta: un fallo aislado no bloquea el panel.
    }
  }, []);

  const refrescarAvisos = useCallback(async () => {
    try {
      const siguiente = await leerAvisos();
      if (vivo.current) setAvisos(siguiente);
    } catch {
      // Igual que arriba: se reintenta en el siguiente ciclo.
    }
  }, []);

  useEffect(() => {
    vivo.current = true;

    void refrescarAgentes();
    void refrescarAvisos();

    void (async () => {
      try {
        const respuesta = await fetch('/api/contador', { cache: 'no-store' });
        if (!respuesta.ok) return;
        const cuerpo = (await respuesta.json()) as {
          consumo?: { tareas?: number; costeModelosEuros?: number };
        };
        if (vivo.current && cuerpo.consumo) {
          setContador({
            tareas: cuerpo.consumo.tareas ?? 0,
            costeModelosEuros: cuerpo.consumo.costeModelosEuros ?? 0,
          });
        }
      } finally {
        if (vivo.current) setCargandoContador(false);
      }
    })();

    void (async () => {
      const guardada = await leerDisposicionPanel();
      if (vivo.current && guardada.length > 0) {
        setDisposicion(normalizarDisposicion(guardada, CATALOGO));
      }
    })();

    let darDeBaja: (() => void) | undefined;
    void (async () => {
      darDeBaja = await suscribirseAAgentesEnVivo(crearFuente(), () => {
        void refrescarAgentes();
        void refrescarAvisos();
      });
    })();

    const respaldo = setInterval(() => {
      void refrescarAgentes();
      void refrescarAvisos();
    }, INTERVALO_RESPALDO_MS);

    return () => {
      vivo.current = false;
      darDeBaja?.();
      clearInterval(respaldo);
    };
  }, [refrescarAgentes, refrescarAvisos]);

  const alCambiarDisposicion = useCallback((siguiente: DisposicionDeWidget[]) => {
    setDisposicion(siguiente);
    void guardarDisposicionPanel(siguiente);
  }, []);

  const alEncargar = useCallback(
    async (datos: { puestoId: string; encargo: string }) => {
      try {
        await encargarTarea(datos);
        await refrescarAgentes();
        return {};
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'El encargo no se pudo enviar.' };
      }
    },
    [refrescarAgentes],
  );

  const alDecidir = useCallback(async (aprobacionId: string, sentido: 'aprobada' | 'rechazada') => {
    setDecidiendo(aprobacionId);
    setErrorGeneral(undefined);
    try {
      await decidirAviso(aprobacionId, sentido);
      setAvisos((actuales) => actuales.filter((a) => a.aprobacionId !== aprobacionId));
    } catch (error) {
      setErrorGeneral(error instanceof Error ? error.message : 'La decisión no se pudo guardar.');
    } finally {
      setDecidiendo(undefined);
    }
  }, []);

  const widgets = {
    saludo: {
      titulo: 'Saludo',
      contenido: <WidgetSaludo nombre={nombre} agentes={agentes} onEncargar={alEncargar} />,
    },
    contador: {
      titulo: 'Contador del periodo',
      contenido: (
        <WidgetContador
          tareas={contador?.tareas ?? 0}
          costeModelosEuros={contador?.costeModelosEuros ?? 0}
          cargando={cargandoContador}
        />
      ),
    },
    ficha: { titulo: 'Indicador de la ficha', contenido: <WidgetFicha agentes={agentes} /> },
    equipo: { titulo: 'Tu equipo', contenido: <WidgetTuEquipo agentes={agentes} /> },
    vencido: {
      titulo: 'Vencido por antigüedad',
      contenido: <WidgetVencidoPorAntiguedad agentes={agentes} />,
    },
    ultimo: { titulo: 'Lo último', contenido: <WidgetLoUltimo agentes={agentes} /> },
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <header className="mb-4">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
            Bitclick Solutions
          </p>
          <h1 className={cn(TEMA.texto.titulo, 'text-3xl')}>Inicio</h1>
        </header>
        <PanelDeWidgets
          disposicion={disposicion}
          widgets={widgets}
          onCambiarDisposicion={alCambiarDisposicion}
          data-testid="inicio-panel-de-widgets"
        />
      </div>

      <aside className="w-full shrink-0 lg:w-80" aria-label="Avisos">
        {errorGeneral ? (
          <p className="mb-2 text-sm text-peligro" role="alert">
            {errorGeneral}
          </p>
        ) : null}
        <ListaDeAvisos titulo="Te necesitan" data-testid="inicio-avisos">
          {avisos.map((aviso) => (
            <AvisoDeAprobacion
              key={aviso.aprobacionId}
              titulo={aviso.puesto}
              aprobando={decidiendo === aviso.aprobacionId}
              alAprobar={() => void alDecidir(aviso.aprobacionId, 'aprobada')}
              alRechazar={() => void alDecidir(aviso.aprobacionId, 'rechazada')}
            >
              {aviso.resumenLegible}
            </AvisoDeAprobacion>
          ))}
        </ListaDeAvisos>
      </aside>
    </main>
  );
}
