'use client';

/**
 * Sala v1 (ADR-022): S2 en escritorio y S4 en el móvil, en una sola vista
 * adaptable. Los datos llegan por el contrato `FuenteDeSala`; la vista no sabe
 * si la fuente es la simulada o la real.
 *
 * - Escritorio (≥ 1024 px): «Salas» en la navegación, conversación en el centro
 *   y panel de miembros a la derecha, abierto por defecto desde 1280 px.
 * - Móvil: cabecera con la fila de presencia, hoja de miembros y cajón de salas.
 */
import {
  AvatarConPresencia,
  AvatarDeAgente,
  AvatarDePersona,
  AvisoDeAprobacion,
  Aviso,
  Boton,
  EtiquetaIA,
  FilaDePresencia,
  HojaMovil,
  IndicadorDeEscritura,
  NavegacionDeSalas,
  PanelDeMiembros,
  Porque,
  TarjetaDePropuesta,
  cn,
  type MiembroVisible,
} from '@aiw/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type {
  ConversacionDeSala,
  FuenteDeSala,
  MiembroDeSala,
  ResumenDeSala,
} from '../../../../lib/sala-contrato';
import { ID_DE_QUIEN_MIRA, crearFuente } from '../../../../lib/sala-fuente';
import {
  aMiembroVisible,
  aplicarPresencia,
  colorDeAgente,
  escribiendoAhora,
  resumenDePresencia,
} from './presentacion';
import { aMensajesVisibles, type AutorVisible, type MensajeVisible } from './traduccion';

/** Cada cuánto se avisa como mucho de que la persona escribe. */
const AVISO_DE_ESCRITURA_MS = 3_000;
/** Ancho desde el que el panel de miembros se abre por defecto (pregunta abierta). */
const PANEL_ABIERTO_DESDE = '(min-width: 1280px)';

type Carga<T> = { estado: 'cargando' } | { estado: 'error' } | { estado: 'listo'; datos: T };

function hrefDeSala(id: string): string {
  return `/panel/sala?sala=${encodeURIComponent(id)}`;
}

function Autor({ autor, hora }: { autor: AutorVisible; hora: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="font-semibold text-texto">{autor.nombre}</span>
      {autor.tipo === 'agente' ? <EtiquetaIA /> : null}
      <span className="text-xs text-texto-3">
        <time>{hora}</time>
      </span>
    </div>
  );
}

function AvatarDeAutor({ autor }: { autor: AutorVisible }) {
  return autor.tipo === 'agente' ? (
    <AvatarDeAgente nombre={autor.nombre} tamano="pequeno" color={colorDeAgente(autor.id)} />
  ) : (
    <AvatarDePersona nombre={autor.nombre} tamano="pequeno" />
  );
}

/**
 * La tarjeta de aprobación no cita ninguna propuesta de operación: Sala v0 no
 * emite ese adjunto todavía (aprobaciones desde la intervención es de _De
 * conversación a trabajo_), así que aquí «Aprobar» solo resuelve la vista, sin
 * llamar a la API. Cuando esa rebanada exista, se conecta igual que la
 * propuesta de más abajo.
 */
function TarjetaDeAprobacion({
  mensaje,
}: {
  mensaje: Extract<MensajeVisible, { tipo: 'aprobacion' }>;
}) {
  const [resuelta, establecerResuelta] = useState(false);
  if (resuelta) {
    return (
      <p
        role="status"
        className="rounded-lg bg-correcto-suave px-3 py-2 text-sm text-texto-correcto"
      >
        Aprobado por ti.
      </p>
    );
  }
  return (
    <AvisoDeAprobacion
      titulo={mensaje.titulo}
      data-testid="tarjeta-aprobacion"
      alAprobar={() => {
        establecerResuelta(true);
      }}
    >
      <p>{mensaje.resumen}</p>
      {mensaje.porque ? (
        <Porque id={`porque-${mensaje.id}`} className="mt-2">
          {mensaje.porque}
        </Porque>
      ) : null}
    </AvisoDeAprobacion>
  );
}

function TarjetaDeLaPropuesta({
  mensaje,
  decidiendo,
  decidir,
}: {
  mensaje: Extract<MensajeVisible, { tipo: 'propuesta' }>;
  decidiendo: boolean;
  decidir: (propuestaId: string, sentido: 'aprobada' | 'rechazada') => void;
}) {
  return (
    <TarjetaDePropuesta
      titulo={mensaje.titulo}
      datos={mensaje.datos}
      data-testid="tarjeta-propuesta"
      {...(mensaje.resuelta ? { resuelta: mensaje.resuelta } : {})}
      acciones={
        mensaje.resuelta ? undefined : (
          <>
            <Boton
              cargando={decidiendo}
              onClick={() => {
                decidir(mensaje.propuestaId, 'aprobada');
              }}
            >
              Confirmar
            </Boton>
            <Boton
              tono="secundario"
              disabled={decidiendo}
              onClick={() => {
                decidir(mensaje.propuestaId, 'rechazada');
              }}
            >
              Descartar
            </Boton>
          </>
        )
      }
    />
  );
}

function Mensaje({
  mensaje,
  decidiendo,
  decidirPropuesta,
}: {
  mensaje: MensajeVisible;
  decidiendo: boolean;
  decidirPropuesta: (propuestaId: string, sentido: 'aprobada' | 'rechazada') => void;
}) {
  if (mensaje.tipo === 'nota') {
    return (
      <p className="py-1 text-center text-xs text-texto-3">
        <time>{mensaje.hora}</time> · {mensaje.texto}
      </p>
    );
  }

  return (
    <article className="flex gap-3" aria-label={`${mensaje.autor.nombre}, ${mensaje.hora}`}>
      <span aria-hidden="true" className="pt-0.5">
        <AvatarDeAutor autor={mensaje.autor} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <Autor autor={mensaje.autor} hora={mensaje.hora} />
        <p className="text-texto">{mensaje.texto}</p>
        {mensaje.tipo === 'aprobacion' ? <TarjetaDeAprobacion mensaje={mensaje} /> : null}
        {mensaje.tipo === 'propuesta' ? (
          <TarjetaDeLaPropuesta
            mensaje={mensaje}
            decidiendo={decidiendo}
            decidir={decidirPropuesta}
          />
        ) : null}
      </div>
    </article>
  );
}

function IconoMenu() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconoMiembros() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none">
      <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3.5 19c.8-3 2.9-4.5 5.5-4.5s4.7 1.5 5.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 14.8c1.5.6 2.5 2 3 4.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const BOTON_ICONO =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-texto-2 hover:bg-superficie-2 hover:text-texto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento';

export interface VistaDeSalaV1Props {
  salaInicial: string;
  /** Para las pruebas: otra fuente que cumpla el contrato. */
  fuente?: FuenteDeSala;
}

export function VistaDeSalaV1({ salaInicial, fuente: fuenteInyectada }: VistaDeSalaV1Props) {
  const fuente = useMemo(() => fuenteInyectada ?? crearFuente(), [fuenteInyectada]);
  const [intento, establecerIntento] = useState(0);
  const [salas, establecerSalas] = useState<Carga<ResumenDeSala[]>>({ estado: 'cargando' });
  const [salaId, establecerSalaId] = useState(salaInicial);
  const [leidas, establecerLeidas] = useState<ReadonlySet<string>>(() => new Set([salaInicial]));
  const [miembros, establecerMiembros] = useState<Carga<MiembroDeSala[]>>({ estado: 'cargando' });
  const [escribiendo, establecerEscribiendo] = useState<Record<string, string>>({});
  const [ahora, establecerAhora] = useState(() => Date.now());
  const [panelAbierto, establecerPanelAbierto] = useState(false);
  const [hoja, establecerHoja] = useState<'miembros' | 'salas' | null>(null);
  const [borrador, establecerBorrador] = useState('');
  const [conversacion, establecerConversacion] = useState<Carga<ConversacionDeSala>>({
    estado: 'cargando',
  });
  const [enviando, establecerEnviando] = useState(false);
  const [errorEnvio, establecerErrorEnvio] = useState<string | undefined>(undefined);
  const [decidiendo, establecerDecidiendo] = useState<Record<string, boolean>>({});
  const ultimoAviso = useRef(0);

  useEffect(() => {
    establecerPanelAbierto(window.matchMedia(PANEL_ABIERTO_DESDE).matches);
  }, []);

  useEffect(() => {
    let vigente = true;
    establecerSalas({ estado: 'cargando' });
    fuente.salas().then(
      (datos) => {
        if (vigente) establecerSalas({ estado: 'listo', datos });
      },
      () => {
        if (vigente) establecerSalas({ estado: 'error' });
      },
    );
    return () => {
      vigente = false;
    };
  }, [fuente, intento]);

  useEffect(() => {
    let vigente = true;
    establecerMiembros({ estado: 'cargando' });
    establecerEscribiendo({});
    establecerConversacion({ estado: 'cargando' });

    const cargarConversacion = () => {
      fuente.mensajes(salaId).then(
        (datos) => {
          if (vigente) establecerConversacion({ estado: 'listo', datos });
        },
        () => {
          if (vigente) establecerConversacion({ estado: 'error' });
        },
      );
    };

    fuente.miembros(salaId).then(
      (datos) => {
        if (vigente) establecerMiembros({ estado: 'listo', datos });
      },
      () => {
        if (vigente) establecerMiembros({ estado: 'error' });
      },
    );
    cargarConversacion();

    // En vivo (criterio de hecho): el cambio `mensaje` lo emite Centrifugo (o su
    // caída a consulta periódica, `SONDEO_SALA_MS` en `lib/sala.ts`) cada vez que
    // alguien escribe en la sala o se decide una propuesta; aquí solo se vuelve a
    // pedir la conversación, sin sondeo propio.
    const darseDeBaja = fuente.suscribir(salaId, (cambio) => {
      if (!vigente || cambio.salaId !== salaId) return;
      if (cambio.tipo === 'presencia') {
        establecerMiembros((actual) =>
          actual.estado === 'listo'
            ? { estado: 'listo', datos: aplicarPresencia(actual.datos, cambio) }
            : actual,
        );
      } else if (cambio.tipo === 'escribiendo') {
        establecerAhora(Date.now());
        establecerEscribiendo((actual) => ({ ...actual, [cambio.miembroId]: cambio.hasta }));
      } else if (cambio.tipo === 'mensaje') {
        cargarConversacion();
      }
    });
    return () => {
      vigente = false;
      darseDeBaja();
    };
  }, [fuente, salaId, intento]);

  // El indicador caduca solo: se revisa cada segundo mientras alguien escribe.
  const hayEscritura = Object.keys(escribiendo).length > 0;
  useEffect(() => {
    if (!hayEscritura) return undefined;
    const reloj = setInterval(() => {
      establecerAhora(Date.now());
    }, 1_000);
    return () => {
      clearInterval(reloj);
    };
  }, [hayEscritura]);

  const elegirSala = useCallback((id: string) => {
    establecerSalaId(id);
    establecerLeidas((actual) => new Set(actual).add(id));
    establecerHoja(null);
    window.history.replaceState(null, '', hrefDeSala(id));
  }, []);

  const listaDeSalas = salas.estado === 'listo' ? salas.datos : [];
  const salaActual = listaDeSalas.find((sala) => sala.id === salaId);
  const nombreDeSala = salaActual?.nombre ?? salaId;
  const salasVisibles = listaDeSalas.map((sala) =>
    leidas.has(sala.id) ? { ...sala, sinLeer: 0, menciones: 0 } : sala,
  );

  const datosDeMiembros = miembros.estado === 'listo' ? miembros.datos : [];
  const visibles: MiembroVisible[] = datosDeMiembros.map((miembro) =>
    aMiembroVisible(miembro, ID_DE_QUIEN_MIRA, ahora),
  );
  const resumen = resumenDePresencia(datosDeMiembros);
  const nombresEscribiendo = escribiendoAhora(
    escribiendo,
    datosDeMiembros,
    ID_DE_QUIEN_MIRA,
    ahora,
  );
  const mensajesVisibles: MensajeVisible[] =
    conversacion.estado === 'listo'
      ? aMensajesVisibles(conversacion.datos.mensajes, conversacion.datos.propuestas)
      : [];

  const alEscribir = (texto: string) => {
    establecerBorrador(texto);
    const instante = Date.now();
    if (texto.trim() && instante - ultimoAviso.current > AVISO_DE_ESCRITURA_MS) {
      ultimoAviso.current = instante;
      fuente.indicarEscritura(salaId);
    }
  };

  // Reutiliza el mismo camino que la vista v0 (`GET /api/sala`, `POST /api/sala/
  // mensajes`): la fuente llama a esos manejadores de ruta, nunca a la API
  // directamente (criterio «reutiliza» de la rebanada).
  const recargarConversacion = () => {
    fuente.mensajes(salaId).then(
      (datos) => {
        establecerConversacion({ estado: 'listo', datos });
      },
      () => undefined,
    );
  };

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const texto = borrador.trim();
    if (!texto || enviando) return;
    establecerEnviando(true);
    establecerErrorEnvio(undefined);
    void fuente
      .enviarMensaje(salaId, texto)
      .then(
        () => {
          establecerBorrador('');
          recargarConversacion();
        },
        (error: unknown) => {
          establecerErrorEnvio(
            error instanceof Error ? error.message : 'No se pudo enviar el mensaje.',
          );
        },
      )
      .finally(() => {
        establecerEnviando(false);
      });
  };

  const decidirPropuesta = (propuestaId: string, sentido: 'aprobada' | 'rechazada') => {
    establecerDecidiendo((actual) => ({ ...actual, [propuestaId]: true }));
    void fuente
      .decidirPropuesta(propuestaId, sentido)
      .then(
        () => {
          recargarConversacion();
        },
        (error: unknown) => {
          establecerErrorEnvio(
            error instanceof Error ? error.message : 'No se pudo registrar la decisión.',
          );
        },
      )
      .finally(() => {
        establecerDecidiendo((actual) => {
          const { [propuestaId]: _quitado, ...resto } = actual;
          return resto;
        });
      });
  };

  if (salas.estado === 'error') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl items-center px-4">
        <Aviso
          tipo="error"
          titulo="No hemos podido abrir las salas"
          data-testid="error-salas"
          accion={
            <Boton
              onClick={() => {
                establecerIntento((n) => n + 1);
              }}
            >
              Reintentar
            </Boton>
          }
        >
          Nada se ha perdido: los mensajes siguen guardados. Vuelve a intentarlo en un momento.
        </Aviso>
      </main>
    );
  }

  const navegacion = (
    <NavegacionDeSalas
      salas={salasVisibles}
      actual={salaId}
      hrefDe={hrefDeSala}
      alElegir={elegirSala}
    />
  );

  const botonOcultar = (
    <button
      type="button"
      className={BOTON_ICONO}
      aria-label="Ocultar miembros"
      data-testid="ocultar-miembros"
      onClick={() => {
        establecerPanelAbierto(false);
      }}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <path
          d="M9 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-fondo text-texto">
      {/* S2 · navegación del panel con «Salas» dentro. */}
      <aside
        aria-label="Navegación del panel"
        className="hidden w-60 shrink-0 flex-col gap-6 border-r border-linea bg-superficie px-3 py-4 lg:flex"
      >
        <p className="px-3 font-titulos text-base font-bold text-texto">AI Workforce</p>
        {navegacion}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col" data-testid="sala-v1">
        <header className="flex items-center gap-2 border-b border-linea bg-superficie px-2 py-2 lg:gap-4 lg:px-6 lg:py-3">
          <button
            type="button"
            className={cn(BOTON_ICONO, 'lg:hidden')}
            aria-label="Abrir salas"
            data-testid="abrir-salas"
            onClick={() => {
              establecerHoja('salas');
            }}
          >
            <IconoMenu />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-titulos text-lg font-semibold text-texto lg:text-xl">
              <span aria-hidden="true" className="text-texto-3">
                #
              </span>
              {nombreDeSala}
            </h1>
            <p className="truncate text-xs text-texto-2 lg:hidden" data-testid="resumen-movil">
              {resumen}
            </p>
          </div>
          <div className="hidden items-center gap-3 lg:flex">
            <span className="flex gap-1.5" aria-hidden="true">
              {visibles
                .filter((miembro) => miembro.estado !== 'anadido')
                .slice(0, 5)
                .map((miembro) => (
                  <AvatarConPresencia
                    key={miembro.id}
                    tipo={miembro.tipo}
                    nombre={miembro.nombre}
                    estado={miembro.estado}
                    tamano="pequeno"
                    {...(miembro.color ? { color: miembro.color } : {})}
                  />
                ))}
            </span>
            <span className="text-sm text-texto-2" data-testid="resumen-escritorio">
              {resumen}
            </span>
            <button
              type="button"
              className={cn(
                'inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
                panelAbierto
                  ? 'border-acento bg-acento-suave text-acento'
                  : 'border-linea bg-superficie text-texto-2 hover:bg-superficie-2',
              )}
              aria-pressed={panelAbierto}
              aria-controls="panel-de-miembros"
              data-testid="alternar-miembros"
              onClick={() => {
                establecerPanelAbierto((abierto) => !abierto);
              }}
            >
              <IconoMiembros />
              Miembros
            </button>
          </div>
          <button
            type="button"
            className={cn(BOTON_ICONO, 'lg:hidden')}
            aria-label="Ver miembros"
            data-testid="abrir-miembros"
            onClick={() => {
              establecerHoja('miembros');
            }}
          >
            <IconoMiembros />
          </button>
        </header>

        {/* S4 · fila de presencia bajo la cabecera. */}
        <div className="lg:hidden">
          <FilaDePresencia
            miembros={visibles}
            maximo={6}
            resumen={`${visibles.length} miembros`}
            etiqueta={`Ver miembros: ${resumen}`}
            alAbrir={() => {
              establecerHoja('miembros');
            }}
          />
        </div>

        <section
          aria-label={`Conversación de #${nombreDeSala}`}
          className="flex-1 overflow-y-auto px-4 py-4 lg:px-6"
          data-testid="conversacion"
        >
          {conversacion.estado === 'error' ? (
            <Aviso
              tipo="error"
              titulo="No hemos podido abrir la conversación"
              data-testid="error-conversacion"
              accion={
                <Boton
                  onClick={() => {
                    establecerIntento((n) => n + 1);
                  }}
                >
                  Reintentar
                </Boton>
              }
            >
              Nada se ha perdido: los mensajes siguen guardados.
            </Aviso>
          ) : mensajesVisibles.length === 0 ? (
            <Aviso
              tipo="vacio"
              titulo={`Todavía no hay mensajes en #${nombreDeSala}`}
              accion={
                <Boton
                  tono="secundario"
                  onClick={() => {
                    document.getElementById('compositor')?.focus();
                  }}
                >
                  Escribir el primero
                </Boton>
              }
            >
              El moderador decide qué agente responde.
            </Aviso>
          ) : (
            <ol className="mx-auto flex max-w-3xl flex-col gap-5">
              {mensajesVisibles.map((mensaje) => (
                <li key={mensaje.id}>
                  <Mensaje
                    mensaje={mensaje}
                    decidiendo={
                      mensaje.tipo === 'propuesta' && decidiendo[mensaje.propuestaId] === true
                    }
                    decidirPropuesta={decidirPropuesta}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>

        <footer className="border-t border-linea bg-superficie px-4 pb-3 pt-1 lg:px-6">
          <div className="mx-auto max-w-3xl">
            {errorEnvio ? (
              <p role="alert" className="mb-2 text-xs text-peligro">
                {errorEnvio}
              </p>
            ) : null}
            <IndicadorDeEscritura nombres={nombresEscribiendo} />
            <form className="flex items-center gap-2" onSubmit={enviar}>
              <label htmlFor="compositor" className="sr-only">
                Mensaje para #{nombreDeSala}
              </label>
              <input
                id="compositor"
                value={borrador}
                onChange={(evento) => {
                  alEscribir(evento.target.value);
                }}
                placeholder={`Mensaje para #${nombreDeSala}`}
                autoComplete="off"
                className="min-h-11 flex-1 rounded-lg border border-linea bg-superficie px-3 text-sm text-texto placeholder:text-texto-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento"
              />
              <Boton
                type="submit"
                className="min-h-11"
                cargando={enviando}
                disabled={borrador.trim().length === 0}
              >
                Enviar
              </Boton>
            </form>
          </div>
        </footer>
      </main>

      {/* S2 · panel de miembros a la derecha. */}
      {panelAbierto ? (
        <aside
          id="panel-de-miembros"
          aria-label="Miembros de la sala"
          className="hidden w-80 shrink-0 overflow-y-auto border-l border-linea bg-superficie p-4 lg:block"
          data-testid="panel-de-miembros"
        >
          {miembros.estado === 'error' ? (
            <Aviso
              tipo="error"
              titulo="No hemos podido cargar los miembros"
              accion={
                <Boton
                  tono="secundario"
                  onClick={() => {
                    establecerIntento((n) => n + 1);
                  }}
                >
                  Reintentar
                </Boton>
              }
            />
          ) : (
            <PanelDeMiembros
              key={salaId}
              miembros={visibles}
              acciones={botonOcultar}
              data-testid="miembros-escritorio"
            />
          )}
        </aside>
      ) : null}

      {/* S4 · hoja de miembros y cajón de salas. */}
      <HojaMovil
        abierta={hoja === 'miembros'}
        titulo={`Miembros · ${visibles.length}`}
        alCerrar={() => {
          establecerHoja(null);
        }}
        data-testid="hoja-miembros"
      >
        <PanelDeMiembros miembros={visibles} agrupar="estado" conFiltros={false} sinTitulo />
      </HojaMovil>
      <HojaMovil
        abierta={hoja === 'salas'}
        titulo="Salas"
        lado="izquierda"
        alCerrar={() => {
          establecerHoja(null);
        }}
        data-testid="cajon-salas"
      >
        {navegacion}
      </HojaMovil>
    </div>
  );
}
