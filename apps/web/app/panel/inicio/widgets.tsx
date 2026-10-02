'use client';

/**
 * Contenido de cada widget del catálogo cerrado v1 (docs/specs/
 * inicio-panel-widgets-avisos.md, criterio de hecho 2): saludo con encargo por
 * frase, indicador del contador, indicador de la ficha, tu equipo, vencido por
 * antigüedad y lo último. Cada uno compone los primitivos ya construidos de
 * `@aiw/ui` (`AvatarDeAgente`, `Indicador`, `Insignia`, `Boton`, `Campo`,
 * `Aviso`) con los tokens de `TEMA`; nada de color ni de radio se escribe a mano
 * aquí (criterio de hecho 7).
 *
 * El estado del ciclo de vida del puesto (propuesto, en prueba, activo, pausado,
 * degradado, dado de baja) se pinta siempre como texto (`Insignia`), nunca con el
 * anillo de presencia de `AvatarDeAgente`: ese anillo es de Sala v1 (conectado,
 * escribiendo…) y mezclarlo aquí sería confundir dos vocabularios distintos.
 */
import {
  AvatarDeAgente,
  Boton,
  Campo,
  Indicador,
  Insignia,
  cn,
  TEMA,
  type PuestoConEmblema,
  type TonoDeInsignia,
} from '@aiw/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { rutaDelDetalle, type AgenteDelInicio, type TareaDelInicio } from '../../../lib/inicio';

const EMBLEMA_POR_NOMBRE: Record<string, PuestoConEmblema> = {
  cobros: 'cobros',
  conciliación: 'conciliacion',
  conciliacion: 'conciliacion',
  previsión: 'prevision',
  prevision: 'prevision',
};

function emblemaDe(nombre: string): PuestoConEmblema | undefined {
  return EMBLEMA_POR_NOMBRE[nombre.trim().toLowerCase()];
}

/** Avatar del agente, con o sin emblema de puesto según lo reconozca `emblemaDe`. */
export function AgenteAvatar({ nombre }: { nombre: string }) {
  const puesto = emblemaDe(nombre);
  return puesto ? (
    <AvatarDeAgente nombre={nombre} tamano="pequeno" puesto={puesto} />
  ) : (
    <AvatarDeAgente nombre={nombre} tamano="pequeno" />
  );
}

const TONO_POR_ESTADO: Record<string, TonoDeInsignia> = {
  activo: 'exito',
  en_prueba: 'neutro',
  propuesto: 'neutro',
  pausado: 'aviso',
  degradado: 'peligro',
  dado_de_baja: 'peligro',
};

const ETIQUETA_ESTADO: Record<string, string> = {
  propuesto: 'Propuesto',
  en_prueba: 'En prueba',
  activo: 'Activo',
  pausado: 'Pausado',
  degradado: 'Degradado',
  dado_de_baja: 'Dado de baja',
};

/** «Hace 3 min», «hace 2 h»: la hora exacta no importa tanto como el orden. */
export function haceCuanto(iso: string, ahoraMs: number = Date.now()): string {
  const desde = Date.parse(iso);
  if (Number.isNaN(desde)) return '';
  const transcurridoMs = Math.max(0, ahoraMs - desde);
  if (transcurridoMs < 45_000) return 'hace un momento';
  const minutos = Math.round(transcurridoMs / 60_000);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} d`;
}

export interface PropsDelSaludo {
  nombre: string;
  agentes: AgenteDelInicio[];
  onEncargar: (datos: { puestoId: string; encargo: string }) => Promise<{ error?: string }>;
}

/** Saludo con encargo por frase (criterio de hecho 3): elige el puesto y escribe el encargo. */
export function WidgetSaludo({ nombre, agentes, onEncargar }: PropsDelSaludo) {
  const [puestoId, setPuestoId] = useState(agentes[0]?.puestoId ?? '');
  const [encargo, setEncargo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [enviado, setEnviado] = useState(false);

  useEffect(() => {
    if (!puestoId && agentes[0]) setPuestoId(agentes[0].puestoId);
  }, [agentes, puestoId]);

  async function encargar() {
    if (!puestoId || encargo.trim().length === 0) return;
    setEnviando(true);
    setError(undefined);
    setEnviado(false);
    const resultado = await onEncargar({ puestoId, encargo: encargo.trim() });
    setEnviando(false);
    if (resultado.error) {
      setError(resultado.error);
      return;
    }
    setEncargo('');
    setEnviado(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className={cn(TEMA.texto.titulo, 'text-base')}>Hola, {nombre || 'de nuevo'}.</p>
      <p className={cn(TEMA.texto.apagado, 'text-sm')}>
        Escribe lo que necesitas y elige quién lo hace.
      </p>
      {agentes.length === 0 ? (
        <p className={cn(TEMA.texto.apagado, 'text-sm')} data-testid="saludo-sin-agentes">
          Todavía no hay ningún agente al que encargarle nada.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="saludo-puesto" className={TEMA.campo.etiqueta}>
              A quién
            </label>
            <select
              id="saludo-puesto"
              className={TEMA.campo.control}
              value={puestoId}
              onChange={(evento) => setPuestoId(evento.target.value)}
            >
              {agentes.map((agente) => (
                <option key={agente.puestoId} value={agente.puestoId}>
                  {agente.nombre} · {agente.departamento}
                </option>
              ))}
            </select>
          </div>
          <Campo
            id="saludo-encargo"
            etiqueta="Qué necesitas"
            valor={encargo}
            onCambio={setEncargo}
            multilinea
            marcador="Revisa las facturas vencidas de hoy…"
            {...(error ? { error } : {})}
          />
          <Boton
            tono="primario"
            cargando={enviando}
            disabled={encargo.trim().length === 0}
            onClick={() => void encargar()}
          >
            Encargar
          </Boton>
          {enviado ? (
            <p
              className={cn(TEMA.indicador.exito, 'text-sm')}
              role="status"
              data-testid="saludo-enviado"
            >
              Encargado. Lo verás en «Lo último» en cuanto arranque.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export interface PropsDelContador {
  tareas: number;
  costeModelosEuros: number;
  cargando: boolean;
}

/** Indicador del contador (criterio de hecho 5): el consumo del periodo en curso. */
export function WidgetContador({ tareas, costeModelosEuros, cargando }: PropsDelContador) {
  if (cargando) return <p className={cn(TEMA.texto.apagado, 'text-sm')}>Leyendo el contador…</p>;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Indicador etiqueta="Tareas del periodo" valor={String(tareas)} />
      <Indicador
        etiqueta="Coste de modelos"
        valor={new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(
          costeModelosEuros,
        )}
      />
    </div>
  );
}

export interface PropsDeLaFicha {
  agentes: AgenteDelInicio[];
}

/**
 * Indicador de la ficha (criterio de hecho 2): la especificación deja el
 * catálogo cerrado con este nombre sin fijar de qué indicador de la ficha se
 * trata; a falta de una definición más concreta y sin que nada materialice
 * todavía `indicador_valor` (`packages/db/src/observacion.ts`), esta rebanada
 * muestra los puestos activos de la organización, que es el primer indicador
 * de cualquier ficha de producto (`docs/producto/*.md`) y ya está en los datos
 * que trae `/api/inicio/agentes`, sin inventar un endpoint nuevo para un dato
 * que hoy nadie calcula.
 */
export function WidgetFicha({ agentes }: PropsDeLaFicha) {
  const activos = agentes.filter((a) => a.estado === 'activo').length;
  if (agentes.length === 0) {
    return <p className={cn(TEMA.texto.apagado, 'text-sm')}>Sin puestos todavía.</p>;
  }
  return (
    <Indicador etiqueta="Puestos activos" valor={String(activos)} ayuda={`de ${agentes.length}`} />
  );
}

/** Abre el detalle de la tarea (qué hizo el agente y qué va a escribir). */
function EnlaceDeTarea({ tarea, children }: { tarea: TareaDelInicio; children: ReactNode }) {
  return (
    <a className={cn('underline', TEMA.foco)} href={rutaDelDetalle(tarea.tareaId)}>
      {children}
    </a>
  );
}

function TareaResumen({ tarea }: { tarea: TareaDelInicio }) {
  return (
    <p className={cn(TEMA.texto.apagado, 'truncate text-xs')} title={tarea.encargo}>
      <EnlaceDeTarea tarea={tarea}>{tarea.encargo}</EnlaceDeTarea> · {haceCuanto(tarea.desde)}
    </p>
  );
}

export interface PropsDeTuEquipo {
  agentes: AgenteDelInicio[];
}

/**
 * Tu equipo (criterio de hecho 1 y 6): cada agente con su estado de ciclo de
 * vida, su tarea en curso, sus últimas completadas, el enlace a la sala de su
 * departamento (Sala v1) y el sello de plantilla (ADR-019). Los enlaces a la
 * página del equipo y a la del propio agente están preparados sin destino: esas
 * páginas son rebanadas propias que todavía no existen.
 */
export function WidgetTuEquipo({ agentes }: PropsDeTuEquipo) {
  if (agentes.length === 0) {
    return (
      <p className={cn(TEMA.texto.apagado, 'text-sm')} data-testid="equipo-vacio">
        Todavía no hay ningún agente en tu organización.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {agentes.map((agente) => (
        <li key={agente.puestoId} className="flex gap-3 border-b border-linea pb-3 last:border-0">
          <AgenteAvatar nombre={agente.nombre} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn(TEMA.texto.titulo, 'text-sm')}>{agente.nombre}</span>
              <Insignia
                etiqueta="Estado"
                valor={ETIQUETA_ESTADO[agente.estado] ?? agente.estado}
                tono={TONO_POR_ESTADO[agente.estado] ?? 'neutro'}
              />
              {agente.origenPlantilla ? <Insignia etiqueta="Origen" valor="Plantilla" /> : null}
            </div>
            {agente.tareaEnCurso ? (
              <TareaResumen tarea={agente.tareaEnCurso} />
            ) : (
              <p className={cn(TEMA.texto.apagado, 'text-xs')}>Sin tarea en curso.</p>
            )}
            {agente.ultimasCompletadas.length > 0 ? (
              <details className="text-xs">
                <summary className={cn(TEMA.texto.apagado, 'cursor-pointer')}>
                  Últimas completadas ({agente.ultimasCompletadas.length})
                </summary>
                <ul className="mt-1 flex flex-col gap-1 pl-3">
                  {agente.ultimasCompletadas.map((tarea) => (
                    <li key={tarea.tareaId}>
                      <TareaResumen tarea={tarea} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-3 text-xs">
              {agente.salaId ? (
                <a
                  className={cn('underline', TEMA.foco)}
                  href={`/panel/sala?sala=${encodeURIComponent(agente.salaId)}`}
                >
                  Ver la sala de {agente.departamento}
                </a>
              ) : null}
              {/* Preparados sin destino (fuera de alcance): páginas propias todavía sin construir. */}
              <span className={TEMA.texto.apagado} aria-disabled="true" title="Todavía no existe">
                Página del equipo
              </span>
              <span className={TEMA.texto.apagado} aria-disabled="true" title="Todavía no existe">
                Página del agente
              </span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface TareaConAgente extends TareaDelInicio {
  agenteNombre: string;
}

export interface PropsDeVencidoPorAntiguedad {
  agentes: AgenteDelInicio[];
}

/**
 * Vencido por antigüedad: las tareas en curso más antiguas primero. El catálogo
 * cerrado nombra este widget sin definir «vencido» para un panel genérico (a
 * diferencia de la ficha de Cobros, que sí habla de facturas vencidas); esta
 * rebanada lo interpreta como «lo que lleva más tiempo abierto», reutilizando
 * `tareaEnCurso` de `/api/inicio/agentes` sin pedir un dato nuevo.
 */
export function WidgetVencidoPorAntiguedad({ agentes }: PropsDeVencidoPorAntiguedad) {
  const abiertas: TareaConAgente[] = agentes
    .flatMap((a) => (a.tareaEnCurso ? [{ ...a.tareaEnCurso, agenteNombre: a.nombre }] : []))
    .sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde));

  if (abiertas.length === 0) {
    return (
      <p className={cn(TEMA.texto.apagado, 'text-sm')} data-testid="vencido-vacio">
        Nada abierto ahora mismo.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {abiertas.slice(0, 5).map((tarea) => (
        <li key={tarea.tareaId} className="flex justify-between gap-2">
          <span className="truncate" title={tarea.encargo}>
            {tarea.agenteNombre}: <EnlaceDeTarea tarea={tarea}>{tarea.encargo}</EnlaceDeTarea>
          </span>
          <span className={cn(TEMA.texto.apagado, 'shrink-0')}>{haceCuanto(tarea.desde)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface PropsDeLoUltimo {
  agentes: AgenteDelInicio[];
}

/** Lo último (criterio de hecho 3): lo más reciente, en curso o completado, de toda la organización. */
export function WidgetLoUltimo({ agentes }: PropsDeLoUltimo) {
  const entradas: (TareaConAgente & { estadoTexto: string })[] = agentes
    .flatMap((a) => [
      ...(a.tareaEnCurso
        ? [{ ...a.tareaEnCurso, agenteNombre: a.nombre, estadoTexto: 'en curso' }]
        : []),
      ...a.ultimasCompletadas.map((t) => ({ ...t, agenteNombre: a.nombre, estadoTexto: t.estado })),
    ])
    .sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde));

  if (entradas.length === 0) {
    return (
      <p className={cn(TEMA.texto.apagado, 'text-sm')} data-testid="lo-ultimo-vacio">
        Todavía no hay ninguna tarea.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2 text-sm" data-testid="lo-ultimo-lista">
      {entradas.slice(0, 6).map((tarea) => (
        <li key={`${tarea.tareaId}-${tarea.estadoTexto}`} className="flex justify-between gap-2">
          <span className="truncate" title={tarea.encargo}>
            {tarea.agenteNombre}: <EnlaceDeTarea tarea={tarea}>{tarea.encargo}</EnlaceDeTarea>
          </span>
          <span className={cn(TEMA.texto.apagado, 'shrink-0')}>
            {tarea.estadoTexto} · {haceCuanto(tarea.desde)}
          </span>
        </li>
      ))}
    </ul>
  );
}
