'use client';

/**
 * Vista de la sala. Sondea el proxy cada dos segundos hasta que Centrifugo haga el
 * fan-out; el estado sale siempre de la base y de los flujos, nunca de aquí.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  SONDEO_SALA_MS,
  esNotaDelModerador,
  etiquetaDeAutor,
  propuestaDelMensaje,
  type DatosDeLaSala,
  type PropuestaDeLaSala,
} from '../../../lib/sala';

function TarjetaDePropuesta({
  propuesta,
  decidir,
}: {
  propuesta: PropuestaDeLaSala;
  decidir: (id: string, sentido: 'aprobada' | 'rechazada') => Promise<void>;
}) {
  const { efectos } = propuesta;
  const [enviando, setEnviando] = useState(false);
  const pulsar = (sentido: 'aprobada' | 'rechazada') => {
    setEnviando(true);
    void decidir(propuesta.id, sentido).finally(() => {
      setEnviando(false);
    });
  };
  return (
    <div
      className="mt-3 rounded-lg border border-neutral-200 p-4 text-sm text-neutral-700"
      data-testid="propuesta"
    >
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-neutral-900">{propuesta.resumen}</strong>
        <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-xs">
          {propuesta.nivelExigido.toUpperCase()}
        </span>
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">{propuesta.estado}</span>
      </div>
      {efectos.puesto?.ficha?.mision ? <p className="mt-2">{efectos.puesto.ficha.mision}</p> : null}
      {efectos.puesto?.ficha?.tareas?.length ? (
        <ul className="mt-2 list-disc pl-5">
          {efectos.puesto.ficha.tareas.map((tarea) => (
            <li key={tarea}>{tarea}</li>
          ))}
        </ul>
      ) : null}
      <h3 className="mt-3 font-semibold text-neutral-900">Herramientas</h3>
      <ul className="mt-1 list-disc pl-5">
        {(efectos.herramientas?.disponibles ?? []).map((h) => (
          <li key={h.nombre}>
            <code>{h.nombre}</code>: {h.descripcion}
          </li>
        ))}
        {(efectos.herramientas?.porConectar ?? []).map((h) => (
          <li key={h.nombre} className="text-neutral-500">
            <code>{h.nombre}</code>: {h.descripcion} (por conectar)
          </li>
        ))}
      </ul>
      <h3 className="mt-3 font-semibold text-neutral-900">Guardrails</h3>
      <ul className="mt-1 list-disc pl-5">
        {(efectos.guardrails ?? []).map((g) => (
          <li key={g.clase}>
            <strong>{g.clase}:</strong> {g.regla}
          </li>
        ))}
      </ul>
      {efectos.coste ? (
        <p className="mt-3">
          Coste: {efectos.coste.eurosMesCliente} € al mes, unas {efectos.coste.tareasMes} tareas.
          {efectos.reversion?.descripcion ? ` ${efectos.reversion.descripcion}` : ''}
        </p>
      ) : null}
      {propuesta.estado === 'pendiente' ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={enviando}
            onClick={() => {
              pulsar('aprobada');
            }}
            className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-50"
          >
            Confirmar
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={() => {
              pulsar('rechazada');
            }}
            className="rounded border border-neutral-300 px-4 py-2 disabled:opacity-50"
          >
            Descartar
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function VistaDeLaSala() {
  const [datos, setDatos] = useState<DatosDeLaSala | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [texto, setTexto] = useState('');

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

  const enviar = async () => {
    const limpio = texto.trim();
    if (!limpio) return;
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
  };

  const decidir = async (id: string, sentido: 'aprobada' | 'rechazada') => {
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

  return (
    <section className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <ol className="flex flex-col gap-3" data-testid="mensajes">
        {(datos?.mensajes ?? []).map((mensaje) => {
          if (esNotaDelModerador(mensaje)) {
            return (
              <li key={mensaje.id}>
                <details className="text-sm text-neutral-500" data-testid="moderador">
                  <summary>Moderador</summary>
                  <p className="mt-1">{mensaje.cuerpo}</p>
                </details>
              </li>
            );
          }
          const propuesta = datos ? propuestaDelMensaje(mensaje, datos.propuestas) : undefined;
          return (
            <li key={mensaje.id} className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs text-neutral-500">{etiquetaDeAutor(mensaje)}</p>
              <p className="mt-1 text-neutral-800">{mensaje.cuerpo}</p>
              {propuesta ? <TarjetaDePropuesta propuesta={propuesta} decidir={decidir} /> : null}
            </li>
          );
        })}
      </ol>
      <form
        className="flex gap-2"
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
          placeholder="¿Cómo vamos de cobros este mes?"
          maxLength={2000}
          className="flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button type="submit" className="rounded bg-neutral-900 px-4 py-2 text-white">
          Enviar
        </button>
      </form>
    </section>
  );
}
