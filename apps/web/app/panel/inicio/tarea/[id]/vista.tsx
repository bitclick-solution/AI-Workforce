'use client';

/**
 * Detalle de una tarea en el panel (docs/specs/detalle-de-la-tarea-en-el-panel.md):
 * qué hace el agente paso a paso y qué va a escribir antes de aprobar.
 *
 * Solo interfaz sobre lo que ya existe (ADR-034): lee `/api/inicio/tareas/:id` y
 * decide con la misma ruta que el panel de avisos (`decidirAviso`), sin duplicar
 * la decisión. Se actualiza reutilizando la conexión de Centrifugo del Inicio
 * (`suscribirseAAgentesEnVivo` con la fuente de Sala v1) y, como el trabajador aún
 * no avisa al anotar cada paso, con el mismo refresco de respaldo del Inicio.
 *
 * Estados diseñados antes que el camino feliz: cargando, no carga (error), no
 * existe, sin pasos todavía, fallida y «necesita a una persona».
 */
import {
  Aviso,
  AvisoDeAprobacion,
  Boton,
  Insignia,
  ListaDePasos,
  PasoDeTarea,
  TEMA,
  cn,
} from '@aiw/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatearEuros } from '../../../../../lib/contador';
import {
  ErrorDelInicio,
  INTERVALO_RESPALDO_MS,
  decidirAviso,
  leerDetalleDeTarea,
  rutaDelDetalle,
  suscribirseAAgentesEnVivo,
  type DetalleDeTarea,
} from '../../../../../lib/inicio';
import { rutaDelExpediente } from '../../../../../lib/expediente';
import { crearFuente } from '../../../../../lib/sala-fuente';
import { AgenteAvatar, haceCuanto } from '../../widgets';
import { estadoDeLaTarea, etiquetaDeNivel, tituloDelPaso } from './presentacion';

const RUTA_DEL_INICIO = '/panel/inicio';

type Carga = 'cargando' | 'listo' | 'no-existe' | 'error';

export interface PropsDelDetalle {
  tareaId: string;
}

function VolverAlInicio() {
  return (
    <a className={cn('text-sm underline', TEMA.foco)} href={RUTA_DEL_INICIO}>
      Volver al inicio
    </a>
  );
}

export function VistaDelDetalle({ tareaId }: PropsDelDetalle) {
  const [detalle, setDetalle] = useState<DetalleDeTarea | undefined>(undefined);
  const [carga, setCarga] = useState<Carga>('cargando');
  const [decidiendo, setDecidiendo] = useState(false);
  const [errorDeDecision, setErrorDeDecision] = useState<string | undefined>(undefined);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    try {
      const siguiente = await leerDetalleDeTarea(tareaId);
      if (!vivo.current) return;
      setDetalle(siguiente);
      setCarga('listo');
    } catch (error) {
      if (!vivo.current) return;
      if (error instanceof ErrorDelInicio && error.estado === 404) {
        setDetalle(undefined);
        setCarga('no-existe');
        return;
      }
      // Con datos ya en pantalla, un fallo aislado no los tapa: el respaldo reintenta.
      setCarga((actual) => (actual === 'listo' ? actual : 'error'));
    }
  }, [tareaId]);

  useEffect(() => {
    vivo.current = true;
    void cargar();

    let darDeBaja: (() => void) | undefined;
    void (async () => {
      const baja = await suscribirseAAgentesEnVivo(crearFuente(), () => void cargar());
      if (vivo.current) darDeBaja = baja;
      else baja();
    })();
    const respaldo = setInterval(() => void cargar(), INTERVALO_RESPALDO_MS);

    return () => {
      vivo.current = false;
      darDeBaja?.();
      clearInterval(respaldo);
    };
  }, [cargar]);

  const alDecidir = useCallback(
    async (aprobacionId: string, sentido: 'aprobada' | 'rechazada') => {
      setDecidiendo(true);
      setErrorDeDecision(undefined);
      try {
        // La misma ruta que el panel de avisos: la decisión no se duplica.
        await decidirAviso(aprobacionId, sentido);
        await cargar();
      } catch (error) {
        if (vivo.current) {
          setErrorDeDecision(
            error instanceof Error ? error.message : 'La decisión no se pudo guardar.',
          );
        }
      } finally {
        if (vivo.current) setDecidiendo(false);
      }
    },
    [cargar],
  );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <nav aria-label="Migas">
        <a className={cn('text-sm underline', TEMA.foco)} href={RUTA_DEL_INICIO}>
          ← Inicio
        </a>
      </nav>
      {carga === 'cargando' ? (
        <p
          className={cn(TEMA.texto.apagado, 'text-sm')}
          role="status"
          data-testid="detalle-cargando"
        >
          Cargando la tarea…
        </p>
      ) : null}
      {carga === 'no-existe' ? (
        <Aviso
          tipo="error"
          titulo="No encontramos esa tarea"
          data-testid="detalle-no-existe"
          accion={<VolverAlInicio />}
        >
          Puede que se haya borrado o que no sea de tu organización.
        </Aviso>
      ) : null}
      {carga === 'error' ? (
        <Aviso
          tipo="error"
          titulo="No se ha podido cargar la tarea"
          data-testid="detalle-error"
          accion={
            <>
              <Boton tono="primario" onClick={() => void cargar()}>
                Reintentar
              </Boton>
              <VolverAlInicio />
            </>
          }
        >
          El panel no ha podido leer el detalle. No se ha perdido nada: lo que el agente hizo sigue
          en el libro de auditoría.
        </Aviso>
      ) : null}
      {detalle && carga === 'listo' ? (
        <Detalle
          detalle={detalle}
          decidiendo={decidiendo}
          errorDeDecision={errorDeDecision}
          alDecidir={alDecidir}
          alActualizar={() => void cargar()}
        />
      ) : null}
    </main>
  );
}

interface PropsDeDetalle {
  detalle: DetalleDeTarea;
  decidiendo: boolean;
  errorDeDecision: string | undefined;
  alDecidir: (aprobacionId: string, sentido: 'aprobada' | 'rechazada') => Promise<void>;
  alActualizar: () => void;
}

function Detalle({
  detalle,
  decidiendo,
  errorDeDecision,
  alDecidir,
  alActualizar,
}: PropsDeDetalle) {
  const estado = estadoDeLaTarea(detalle.estado);
  const pendiente = detalle.aprobacionPendiente;
  const ultimoError = [...detalle.pasos].reverse().find((p) => p.resultado === 'error');

  return (
    <>
      <header className="flex flex-col gap-3">
        <p className={TEMA.texto.etiqueta}>Tarea</p>
        <h1 className={cn(TEMA.texto.titulo, 'text-2xl')}>{detalle.encargo}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <AgenteAvatar nombre={detalle.agente} />
          <span className={cn(TEMA.texto.titulo, 'text-sm')}>{detalle.agente}</span>
          <span className={cn(TEMA.texto.apagado, 'text-sm')}>· {detalle.departamento}</span>
          <span data-testid="detalle-estado">
            <Insignia etiqueta="Estado" valor={estado.etiqueta} tono={estado.tono} />
          </span>
          <span data-testid="detalle-coste">
            {detalle.delegadas.length > 0 ? (
              <Insignia
                etiqueta="Coste con delegadas"
                valor={formatearEuros(detalle.costeTotalEuros)}
              />
            ) : (
              <Insignia etiqueta="Coste" valor={formatearEuros(detalle.costeEuros)} />
            )}
          </span>
        </div>
        <p className={cn(TEMA.texto.apagado, 'text-xs')}>
          Encargada {haceCuanto(detalle.desde)} · Esta página se actualiza sola ·{' '}
          <a
            className={cn('underline', TEMA.foco)}
            href={rutaDelExpediente(detalle.puestoId)}
            data-testid="detalle-expediente"
          >
            Expediente de {detalle.agente}
          </a>
        </p>
      </header>

      {pendiente && pendiente.puedeDecidir ? (
        <div>
          {errorDeDecision ? (
            <p
              className="mb-2 text-sm text-peligro"
              role="alert"
              data-testid="detalle-error-decision"
            >
              {errorDeDecision}
            </p>
          ) : null}
          <AvisoDeAprobacion
            titulo="Esto es lo que va a escribir"
            aprobando={decidiendo}
            alAprobar={() => void alDecidir(pendiente.aprobacionId, 'aprobada')}
            alRechazar={() => void alDecidir(pendiente.aprobacionId, 'rechazada')}
            data-testid="detalle-aprobacion"
            quienLoPide={
              <>
                <AgenteAvatar nombre={detalle.agente} />
                <span className="text-sm font-medium">{detalle.agente} te lo pide</span>
              </>
            }
          >
            <p className="whitespace-pre-wrap">{pendiente.resumenLegible}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Insignia etiqueta="Nivel" valor={etiquetaDeNivel(pendiente.nivelExigido)} />
              <Insignia etiqueta="Acción" valor={pendiente.claseAccion} />
            </div>
          </AvisoDeAprobacion>
        </div>
      ) : null}

      {pendiente && !pendiente.puedeDecidir ? (
        <Aviso
          tipo="necesita-persona"
          titulo="Esto es lo que va a escribir"
          data-testid="detalle-aprobacion-ajena"
          accion={
            <a className={cn('text-sm underline', TEMA.foco)} href={RUTA_DEL_INICIO}>
              Volver al inicio
            </a>
          }
        >
          <p className="whitespace-pre-wrap">{pendiente.resumenLegible}</p>
          <p className="mt-2">
            Esta aprobación se la han pedido a otra persona de tu organización: tú puedes verla,
            pero no decidirla.
          </p>
        </Aviso>
      ) : null}

      {detalle.estado === 'fallida' ? (
        <Aviso
          tipo="error"
          titulo="La tarea ha terminado con un error"
          data-testid="detalle-fallida"
          accion={<VolverAlInicio />}
        >
          {ultimoError?.porque ??
            'El libro no anota el motivo del error. Revisa los pasos de abajo.'}
        </Aviso>
      ) : null}

      <section aria-labelledby="detalle-pasos" className="flex flex-col gap-3">
        <h2 id="detalle-pasos" className={cn(TEMA.texto.titulo, 'text-lg')}>
          Qué ha hecho el agente
        </h2>
        {detalle.pasos.length === 0 ? (
          <Aviso
            tipo="vacio"
            titulo="El agente todavía no ha dado ningún paso"
            data-testid="detalle-sin-pasos"
            accion={
              <Boton tono="secundario" onClick={alActualizar}>
                Actualizar
              </Boton>
            }
          >
            Cuando empiece a trabajar, los pasos aparecerán aquí sin que tengas que recargar.
          </Aviso>
        ) : (
          <ListaDePasos>
            {detalle.pasos.map((paso) => (
              <PasoDeTarea
                key={paso.orden}
                id={`paso-${paso.orden}`}
                titulo={tituloDelPaso(paso)}
                resultado={paso.resultado}
                cuando={haceCuanto(paso.creadoEn)}
                coste={formatearEuros(paso.costeEuros)}
                {...(paso.nivel ? { nivel: etiquetaDeNivel(paso.nivel) } : {})}
                porque={paso.porque}
                sinNecesitarPorque={paso.tipo === 'arranque' || paso.tipo === 'decision'}
              >
                {paso.claseAccion ? `Clase de acción: ${paso.claseAccion}` : null}
              </PasoDeTarea>
            ))}
          </ListaDePasos>
        )}
      </section>

      {detalle.delegadas.length > 0 ? (
        <section
          aria-labelledby="detalle-delegadas"
          className="flex flex-col gap-3"
          data-testid="detalle-delegadas"
        >
          <h2 id="detalle-delegadas" className={cn(TEMA.texto.titulo, 'text-lg')}>
            Tareas que ha delegado
          </h2>
          <ul className="flex flex-col gap-3">
            {detalle.delegadas.map((delegada) => {
              const estadoDelegada = estadoDeLaTarea(delegada.estado);
              return (
                <li
                  key={delegada.tareaId}
                  className={cn(TEMA.superficie.tarjeta, 'flex flex-col gap-2 p-4')}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <AgenteAvatar nombre={delegada.agente} />
                    <span className={cn(TEMA.texto.titulo, 'text-sm')}>{delegada.agente}</span>
                    <span className={cn(TEMA.texto.apagado, 'text-sm')}>
                      · {delegada.departamento}
                    </span>
                  </div>
                  <a
                    className={cn('text-sm underline', TEMA.foco)}
                    href={rutaDelDetalle(delegada.tareaId)}
                  >
                    {delegada.encargo ?? 'Sin encargo anotado'}
                  </a>
                  <div className="flex flex-wrap gap-2">
                    <Insignia
                      etiqueta="Estado"
                      valor={estadoDelegada.etiqueta}
                      tono={estadoDelegada.tono}
                    />
                    <Insignia etiqueta="Coste" valor={formatearEuros(delegada.costeEuros)} />
                    {delegada.cruzaDepartamento ? (
                      <Insignia etiqueta="Alcance" valor="Pide a otro departamento" />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}
