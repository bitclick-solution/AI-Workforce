'use client';

/**
 * Expediente de un agente en el panel (docs/specs/expediente-por-agente-n0-n1.md):
 * con qué nivel trabaja en cada clase de acción, cómo ha cambiado, qué ha aprendido,
 * qué intentó que la política rechazó y cuánto le falta para subir.
 *
 * Solo lectura (ADR-034): no hay ningún botón que suba o baje niveles ni que
 * promocione lecciones. Lee `/api/puestos/:id/expediente` una vez; el único control
 * es «Reintentar» cuando la lectura falla.
 *
 * Estados diseñados antes que el camino feliz: cargando, no carga (error), no
 * existe, sin versión activa, sin lecciones y sin acciones rechazadas.
 */
import {
  Aviso,
  Boton,
  Insignia,
  LineaDeNiveles,
  ListaDePasos,
  MedidorDeCriterio,
  PasoDeTarea,
  TEMA,
  cn,
} from '@aiw/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatearEuros } from '../../../../../../lib/contador';
import {
  leerExpedienteDelPuesto,
  type ClaseDelExpediente,
  type ExpedienteDelPuesto,
} from '../../../../../../lib/expediente';
import { ErrorDelInicio } from '../../../../../../lib/inicio';
import { AgenteAvatar, ETIQUETA_ESTADO, TONO_POR_ESTADO, haceCuanto } from '../../../widgets';
import {
  criteriosDelAscenso,
  enlaceAlLibro,
  estadoDeLaLeccion,
  etiquetaDeNivel,
  fraseDelCambio,
  origenDelCambio,
  textoSinAscenso,
} from './presentacion';

const RUTA_DEL_INICIO = '/panel/inicio';

type Carga = 'cargando' | 'listo' | 'no-existe' | 'error';

export interface PropsDelExpediente {
  puestoId: string;
}

function VolverAlInicio() {
  return (
    <a className={cn('text-sm underline', TEMA.foco)} href={RUTA_DEL_INICIO}>
      Volver al inicio
    </a>
  );
}

export function VistaDelExpediente({ puestoId }: PropsDelExpediente) {
  const [expediente, setExpediente] = useState<ExpedienteDelPuesto | undefined>(undefined);
  const [carga, setCarga] = useState<Carga>('cargando');
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCarga((actual) => (actual === 'listo' ? actual : 'cargando'));
    try {
      const siguiente = await leerExpedienteDelPuesto(puestoId);
      if (!vivo.current) return;
      setExpediente(siguiente);
      setCarga('listo');
    } catch (error) {
      if (!vivo.current) return;
      if (error instanceof ErrorDelInicio && error.estado === 404) {
        setExpediente(undefined);
        setCarga('no-existe');
        return;
      }
      setCarga('error');
    }
  }, [puestoId]);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    return () => {
      vivo.current = false;
    };
  }, [cargar]);

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
          data-testid="expediente-cargando"
        >
          Cargando el expediente…
        </p>
      ) : null}
      {carga === 'no-existe' ? (
        <Aviso
          tipo="error"
          titulo="No encontramos ese agente"
          data-testid="expediente-no-existe"
          accion={<VolverAlInicio />}
        >
          Puede que se haya dado de baja o que no sea de tu organización.
        </Aviso>
      ) : null}
      {carga === 'error' ? (
        <Aviso
          tipo="error"
          titulo="No se ha podido cargar el expediente"
          data-testid="expediente-error"
          accion={
            <>
              <Boton tono="primario" onClick={() => void cargar()}>
                Reintentar
              </Boton>
              <VolverAlInicio />
            </>
          }
        >
          El panel no ha podido leer el expediente. No se ha perdido nada: lo que el agente hizo
          sigue en el libro de auditoría.
        </Aviso>
      ) : null}
      {expediente && carga === 'listo' ? <Expediente expediente={expediente} /> : null}
    </main>
  );
}

function Expediente({ expediente }: { expediente: ExpedienteDelPuesto }) {
  return (
    <>
      <header className="flex flex-col gap-3">
        <p className={TEMA.texto.etiqueta}>Expediente</p>
        <div className="flex flex-wrap items-center gap-3">
          <AgenteAvatar nombre={expediente.nombre} />
          <h1 className={cn(TEMA.texto.titulo, 'text-2xl')}>{expediente.nombre}</h1>
          <span className={cn(TEMA.texto.apagado, 'text-sm')}>· {expediente.departamento}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span data-testid="expediente-estado">
            <Insignia
              etiqueta="Estado"
              valor={ETIQUETA_ESTADO[expediente.estado] ?? expediente.estado}
              tono={TONO_POR_ESTADO[expediente.estado] ?? 'neutro'}
            />
          </span>
          {expediente.versionActiva ? (
            <span data-testid="expediente-version">
              <Insignia etiqueta="Versión activa" valor={String(expediente.versionActiva.numero)} />
            </span>
          ) : null}
        </div>
        <p className={cn(TEMA.texto.apagado, 'text-xs')}>
          Aquí solo se mira: los niveles y las lecciones se cambian desde sus propias pantallas.
        </p>
      </header>

      {expediente.versionActiva === null ? (
        <Aviso
          tipo="vacio"
          titulo="Este agente todavía no tiene versión activa"
          data-testid="expediente-sin-version"
          accion={<VolverAlInicio />}
        >
          Cuando se active su primera versión, aquí aparecerán sus niveles y lo que vaya
          aprendiendo.
        </Aviso>
      ) : (
        <>
          <SeccionDeNiveles expediente={expediente} />
          <SeccionDeLecciones expediente={expediente} />
          <SeccionDeRechazadas expediente={expediente} />
        </>
      )}
    </>
  );
}

function TarjetaDeClase({
  clase,
  expediente,
}: {
  clase: ClaseDelExpediente;
  expediente: ExpedienteDelPuesto;
}) {
  const inicial = expediente.versiones[0]?.niveles[clase.claseAccion];
  const criterios = clase.ascenso ? criteriosDelAscenso(clase.ascenso) : [];
  return (
    <li
      className={cn(TEMA.superficie.tarjeta, 'flex flex-col gap-3 p-4')}
      data-testid={`clase-${clase.claseAccion}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={cn(TEMA.texto.titulo, 'text-base')}>{clase.claseAccion}</h3>
        {clase.prohibida ? (
          <Insignia etiqueta="Nivel" valor="Prohibida" tono="peligro" />
        ) : clase.nivel ? (
          <Insignia etiqueta="Nivel" valor={etiquetaDeNivel(clase.nivel)} />
        ) : (
          <Insignia etiqueta="Nivel" valor="Ya no está en la política" tono="aviso" />
        )}
      </div>

      {clase.ascenso ? (
        <div className="flex flex-col gap-3" data-testid={`ascenso-${clase.claseAccion}`}>
          <p className={cn(TEMA.texto.cuerpo, 'text-sm')}>
            Avance hacia {etiquetaDeNivel(clase.ascenso.a)}:{' '}
            <strong>{clase.ascenso.cumplidos} de 4 criterios cumplidos</strong>
          </p>
          {criterios.map((c) => (
            <MedidorDeCriterio
              key={c.id}
              etiqueta={c.etiqueta}
              valor={c.valor}
              requerido={c.requerido}
              progreso={c.progreso}
              cumplido={c.cumplido}
              data-testid={`criterio-${clase.claseAccion}-${c.id}`}
            />
          ))}
        </div>
      ) : clase.sinAscenso ? (
        <p
          className={cn(TEMA.texto.apagado, 'text-sm')}
          data-testid={`sin-ascenso-${clase.claseAccion}`}
        >
          {textoSinAscenso(clase.sinAscenso, clase.nivel)}
        </p>
      ) : null}

      <LineaDeNiveles
        inicial={
          inicial
            ? `Empezó en ${etiquetaDeNivel(inicial)}`
            : 'No estaba en la política de la primera versión'
        }
        cambios={clase.historial.map((cambio) => ({
          id: `${cambio.versionPuestoId}-${cambio.claseAccion}`,
          titulo: fraseDelCambio(cambio),
          cuando: haceCuanto(cambio.fecha),
          instante: cambio.fecha,
          children: origenDelCambio(cambio, expediente.lecciones),
        }))}
        data-testid={`historial-${clase.claseAccion}`}
      />
    </li>
  );
}

function SeccionDeNiveles({ expediente }: { expediente: ExpedienteDelPuesto }) {
  return (
    <section aria-labelledby="expediente-niveles" className="flex flex-col gap-3">
      <h2 id="expediente-niveles" className={cn(TEMA.texto.titulo, 'text-lg')}>
        Con qué nivel trabaja
      </h2>
      {expediente.clases.length === 0 ? (
        <Aviso
          tipo="vacio"
          titulo="La política no declara ninguna clase de acción"
          accion={<VolverAlInicio />}
        >
          Sin niveles declarados, el agente pide permiso para todo.
        </Aviso>
      ) : (
        <ul className="flex flex-col gap-3">
          {expediente.clases.map((clase) => (
            <TarjetaDeClase key={clase.claseAccion} clase={clase} expediente={expediente} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SeccionDeLecciones({ expediente }: { expediente: ExpedienteDelPuesto }) {
  return (
    <section aria-labelledby="expediente-lecciones" className="flex flex-col gap-3">
      <h2 id="expediente-lecciones" className={cn(TEMA.texto.titulo, 'text-lg')}>
        Lo que ha aprendido
      </h2>
      {expediente.lecciones.length === 0 ? (
        <Aviso
          tipo="vacio"
          titulo="Todavía no ha aprendido nada"
          data-testid="lecciones-vacio"
          accion={<VolverAlInicio />}
        >
          Cuando corrijas o apruebes con cambios lo que propone, aparecerán aquí las lecciones.
        </Aviso>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="lecciones">
          {expediente.lecciones.map((leccion) => {
            const estado = estadoDeLaLeccion(leccion.estado);
            return (
              <li
                key={leccion.leccionId}
                className={cn(TEMA.superficie.tarjeta, 'flex flex-col gap-2 p-4')}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className={cn(TEMA.texto.titulo, 'text-base')}>{leccion.titulo}</p>
                  <Insignia etiqueta="Estado" valor={estado.etiqueta} tono={estado.tono} />
                </div>
                {leccion.linea ? (
                  <p className={cn(TEMA.texto.cuerpo, 'text-sm')}>{leccion.linea}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SeccionDeRechazadas({ expediente }: { expediente: ExpedienteDelPuesto }) {
  const { rechazadas, totalRechazadas } = expediente;
  return (
    <section aria-labelledby="expediente-rechazadas" className="flex flex-col gap-3">
      <h2 id="expediente-rechazadas" className={cn(TEMA.texto.titulo, 'text-lg')}>
        Lo que intentó y la política no le dejó
      </h2>
      {rechazadas.length === 0 ? (
        <Aviso
          tipo="vacio"
          titulo="La política no ha rechazado ninguna acción"
          data-testid="rechazadas-vacio"
          accion={<VolverAlInicio />}
        >
          Si el agente intenta algo que su nivel no permite, quedará aquí con el motivo.
        </Aviso>
      ) : (
        <>
          {totalRechazadas > rechazadas.length ? (
            <p className={cn(TEMA.texto.apagado, 'text-xs')}>
              Mostrando las {rechazadas.length} más recientes de {totalRechazadas}.
            </p>
          ) : null}
          <ListaDePasos data-testid="rechazadas">
            {rechazadas.map((r) => (
              <PasoDeTarea
                key={r.numeroOrden}
                id={`rechazada-${r.numeroOrden}`}
                titulo={`Intentó usar ${r.herramienta ? `«${r.herramienta}»` : 'una herramienta'} y la política no se lo permitió`}
                resultado="rechazado"
                cuando={haceCuanto(r.creadoEn)}
                coste={formatearEuros(r.costeEuros)}
                {...(r.nivel ? { nivel: etiquetaDeNivel(r.nivel) } : {})}
                porque={r.porque}
              >
                <span>Clase de acción: {r.claseAccion}</span>
                {r.tareaId ? (
                  <>
                    {' · '}
                    <a
                      className={cn('underline', TEMA.foco)}
                      href={enlaceAlLibro(r.tareaId, r.numeroOrden)}
                    >
                      Ver en la tarea
                    </a>
                  </>
                ) : null}
              </PasoDeTarea>
            ))}
          </ListaDePasos>
        </>
      )}
    </section>
  );
}
