'use client';

/**
 * Vista de la sala como un chat: burbujas, avatares, hora, la persona a la derecha
 * y el equipo a la izquierda, lista con desplazamiento propio y el cuadro de
 * escribir fijo abajo. Sondea el proxy cada dos segundos hasta que Centrifugo haga
 * el fan-out; el estado sale siempre de la base y de los flujos, nunca de aquí.
 */
import { AvatarDeAgente, AvatarDePersona, Boton } from '@aiw/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  SONDEO_SALA_MS,
  esNotaDelModerador,
  esperandoRespuesta,
  horaCorta,
  propuestaDelMensaje,
  type DatosDeLaSala,
  type MensajeDeLaSala,
  type PropuestaDeLaSala,
} from '../../../lib/sala';

type Decidir = (id: string, sentido: 'aprobada' | 'rechazada') => Promise<void>;

const ESTADO_LEGIBLE: Record<string, string> = {
  pendiente: 'Pendiente de tu confirmación',
  aprobada: 'Aprobada',
  ejecutada: 'Contratado',
  rechazada: 'Descartada',
};

function TarjetaDePropuesta({
  propuesta,
  decidir,
}: {
  propuesta: PropuestaDeLaSala;
  decidir: Decidir;
}) {
  const { efectos } = propuesta;
  const [enviando, setEnviando] = useState(false);
  const pulsar = (sentido: 'aprobada' | 'rechazada') => {
    setEnviando(true);
    void decidir(propuesta.id, sentido).finally(() => {
      setEnviando(false);
    });
  };
  const disponibles = efectos.herramientas?.disponibles ?? [];
  const porConectar = efectos.herramientas?.porConectar ?? [];
  return (
    <div
      className="mt-2 overflow-hidden rounded-xl border border-linea bg-superficie text-sm text-texto-2 shadow-sm"
      data-testid="propuesta"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-linea bg-acento-suave px-4 py-2">
        <strong className="text-texto">{efectos.puesto?.nombre ?? propuesta.resumen}</strong>
        <span className="rounded-full bg-superficie px-2 py-0.5 font-mono text-xs text-acento">
          {propuesta.nivelExigido.toUpperCase()}
        </span>
        <span className="ml-auto text-xs text-acento">
          {ESTADO_LEGIBLE[propuesta.estado] ?? propuesta.estado}
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        {efectos.puesto?.ficha?.mision ? (
          <p className="text-texto">{efectos.puesto.ficha.mision}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {disponibles.map((h) => (
            <span
              key={h.nombre}
              title={h.descripcion}
              className="rounded-full bg-correcto-suave px-2 py-0.5 font-mono text-xs text-texto-correcto"
            >
              {h.nombre}
            </span>
          ))}
          {porConectar.map((h) => (
            <span
              key={h.nombre}
              title={`${h.descripcion} (por conectar)`}
              className="rounded-full border border-dashed border-linea px-2 py-0.5 font-mono text-xs text-texto-3"
            >
              {h.nombre} · por conectar
            </span>
          ))}
        </div>
        <details className="text-xs text-texto-2">
          <summary className="cursor-pointer select-none">Guardrails y tareas</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {(efectos.puesto?.ficha?.tareas ?? []).map((tarea) => (
              <li key={tarea}>• {tarea}</li>
            ))}
            {(efectos.guardrails ?? []).map((g) => (
              <li key={g.clase}>
                <strong className="capitalize">{g.clase}:</strong> {g.regla}
              </li>
            ))}
          </ul>
        </details>
        {efectos.coste ? (
          <p className="text-xs text-texto-2">
            {efectos.coste.eurosMesCliente} € al mes · unas {efectos.coste.tareasMes} tareas
            {efectos.reversion?.descripcion ? ` · ${efectos.reversion.descripcion}` : ''}
          </p>
        ) : null}
        {propuesta.estado === 'pendiente' ? (
          <div className="flex gap-2">
            <Boton
              tono="primario"
              cargando={enviando}
              onClick={() => {
                pulsar('aprobada');
              }}
            >
              Confirmar
            </Boton>
            <Boton
              tono="secundario"
              disabled={enviando}
              onClick={() => {
                pulsar('rechazada');
              }}
            >
              Descartar
            </Boton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ mensaje }: { mensaje: MensajeDeLaSala }) {
  return (
    <AvatarDeAgente
      nombre={mensaje.autor.nombre}
      color={mensaje.autor.tipo === 'plataforma' ? 'lila' : 'menta'}
      tamano="pequeno"
    />
  );
}

function Burbuja({
  mensaje,
  propuesta,
  decidir,
}: {
  mensaje: MensajeDeLaSala;
  propuesta: PropuestaDeLaSala | undefined;
  decidir: Decidir;
}) {
  if (esNotaDelModerador(mensaje)) {
    return (
      <li className="flex justify-center" data-testid="moderador">
        <details className="max-w-[80%] rounded-full bg-superficie-2 px-3 py-1 text-center text-xs text-texto-3 open:rounded-xl">
          <summary className="cursor-pointer select-none">Moderador · ver por qué</summary>
          <p className="mt-1">{mensaje.cuerpo}</p>
        </details>
      </li>
    );
  }

  const hora = horaCorta(mensaje.creadoEn);
  if (mensaje.autor.tipo === 'persona') {
    return (
      <li className="flex items-end justify-end gap-2">
        <div className="max-w-[75%]">
          <div className="rounded-2xl rounded-br-md bg-persona px-4 py-2 text-sobre-persona">
            {mensaje.cuerpo}
          </div>
          <p className="mt-1 text-right text-[11px] text-texto-3">
            {mensaje.autor.nombre} · {hora}
          </p>
        </div>
        <AvatarDePersona nombre={mensaje.autor.nombre} tamano="pequeno" />
      </li>
    );
  }

  const plataforma = mensaje.autor.tipo === 'plataforma';
  return (
    <li className="flex items-end gap-2">
      <Avatar mensaje={mensaje} />
      <div className={propuesta ? 'w-full max-w-[85%]' : 'max-w-[75%]'}>
        <p className="mb-1 text-[11px] text-texto-3">
          <span className="font-medium text-texto-2">{mensaje.autor.nombre}</span>
          {plataforma ? ' · plataforma' : ' · agente'} · {hora}
        </p>
        <div
          className={`rounded-2xl rounded-bl-md px-4 py-2 ${
            plataforma ? 'bg-acento-suave text-texto' : 'bg-superficie text-texto shadow-sm'
          }`}
        >
          {mensaje.cuerpo}
        </div>
        {propuesta ? <TarjetaDePropuesta propuesta={propuesta} decidir={decidir} /> : null}
      </div>
    </li>
  );
}

export function VistaDeLaSala() {
  const [datos, setDatos] = useState<DatosDeLaSala | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const fondo = useRef<HTMLDivElement>(null);
  const ultimoVisto = useRef<string | undefined>(undefined);

  const leer = useCallback(async () => {
    try {
      const respuesta = await fetch('/api/sala', { cache: 'no-store' });
      const cuerpo = (await respuesta.json()) as DatosDeLaSala & { error?: string };
      if (!respuesta.ok) {
        setError(cuerpo.error ?? `No se pudo leer la sala (${respuesta.status}).`);
        return;
      }
      setDatos(cuerpo);
      setError(undefined);
    } catch {
      setError('No se pudo leer la sala.');
    }
  }, []);

  useEffect(() => {
    void leer();
    const intervalo = setInterval(() => {
      void leer();
    }, SONDEO_SALA_MS);
    return () => {
      clearInterval(intervalo);
    };
  }, [leer]);

  // Como en cualquier chat: al llegar un mensaje nuevo, la lista baja hasta él.
  const mensajes = datos?.mensajes ?? [];
  const ultimo = mensajes.at(-1)?.id;
  useEffect(() => {
    if (ultimo !== undefined && ultimo !== ultimoVisto.current) {
      ultimoVisto.current = ultimo;
      fondo.current?.scrollIntoView({ block: 'end' });
    }
  }, [ultimo]);

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    try {
      const respuesta = await fetch('/api/sala/mensajes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texto: limpio }),
      });
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
        setError(cuerpo.error ?? 'No se pudo enviar el mensaje.');
        return;
      }
      setTexto('');
      void leer();
    } finally {
      setEnviando(false);
    }
  };

  const decidir: Decidir = async (id, sentido) => {
    const respuesta = await fetch(`/api/sala/propuestas/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentido }),
    });
    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      setError(cuerpo.error ?? 'No se pudo registrar la decisión.');
    }
    void leer();
  };

  const participantes = new Set(
    mensajes.filter((m) => m.autor.tipo === 'puesto').map((m) => m.autor.nombre),
  );

  return (
    <section className="flex h-[calc(100vh-10rem)] min-h-[32rem] flex-col overflow-hidden rounded-2xl border border-linea bg-superficie-2 shadow-sm">
      <header className="flex items-center gap-3 border-b border-linea bg-superficie px-4 py-3">
        <span className="text-lg font-semibold text-texto-3">#</span>
        <div>
          <h2 className="font-titulos font-semibold leading-tight text-texto">general</h2>
          <p className="text-xs text-texto-3">
            {participantes.size > 0
              ? `${[...participantes].join(', ')} · moderador · Director de IA`
              : 'Moderador · Director de IA'}
          </p>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="border-b border-peligro bg-peligro-suave px-4 py-2 text-sm text-peligro"
        >
          {error}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {mensajes.length === 0 ? (
          <p className="mt-16 text-center text-sm text-texto-3">
            Pregunta a tu equipo o pide un agente nuevo: «contrata un agente de conciliación en
            Finanzas».
          </p>
        ) : null}
        <ol className="flex flex-col gap-4" data-testid="mensajes">
          {mensajes.map((mensaje) => (
            <Burbuja
              key={mensaje.id}
              mensaje={mensaje}
              propuesta={datos ? propuestaDelMensaje(mensaje, datos.propuestas) : undefined}
              decidir={decidir}
            />
          ))}
          {esperandoRespuesta(mensajes) ? (
            <li className="flex items-center gap-2 text-xs text-texto-3" data-testid="respondiendo">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-texto-3 [animation-delay:300ms]" />
              </span>
              El equipo está respondiendo…
            </li>
          ) : null}
        </ol>
        <div ref={fondo} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-linea bg-superficie px-3 py-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
      >
        <label className="sr-only" htmlFor="mensaje">
          Mensaje para la sala
        </label>
        <input
          id="mensaje"
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
          }}
          placeholder="Escribe a #general…"
          maxLength={2000}
          autoComplete="off"
          className="flex-1 rounded-full border border-linea bg-superficie-2 px-4 py-2 text-texto outline-none focus:border-acento focus:bg-superficie"
        />
        <Boton type="submit" disabled={enviando || texto.trim().length === 0} ancho="auto">
          Enviar
        </Boton>
      </form>
    </section>
  );
}
