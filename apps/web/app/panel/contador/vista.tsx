'use client';

/**
 * Vista del contador. Sondea el proxy del servidor cada cinco segundos.
 *
 * El sondeo es temporal y está dicho en la especificación: los eventos ya se
 * escriben en `evento_salida`, y cuando exista el publicador hacia Centrifugo esta
 * vista cambia de sondeo a suscripción sin tocar la API ni el modelo. Mientras
 * tanto, `ultimaAnotacion` deja comparar un entero para saber si algo cambió.
 */
import { useEffect, useState } from 'react';

import {
  SONDEO_MS,
  esRancio,
  etiquetaTareas,
  formatearEntero,
  formatearEuros,
  type DatosDelContador,
} from '../../../lib/contador';

export function VistaDelContador() {
  const [datos, setDatos] = useState<DatosDelContador | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let vivo = true;

    const leer = async () => {
      try {
        const respuesta = await fetch('/api/contador', { cache: 'no-store' });
        const cuerpo = (await respuesta.json()) as DatosDelContador & { error?: string };
        if (!vivo) return;
        if (!respuesta.ok) {
          setError(cuerpo.error ?? `El panel no pudo leer el contador (${respuesta.status}).`);
          return;
        }
        setDatos(cuerpo);
        setError(undefined);
      } catch {
        if (vivo) setError('El panel no pudo leer el contador.');
      }
    };

    void leer();
    const temporizador = setInterval(() => void leer(), SONDEO_MS);
    return () => {
      vivo = false;
      clearInterval(temporizador);
    };
  }, []);

  if (error) {
    return (
      <p className="rounded-md bg-red-50 p-4 text-sm text-red-900" data-testid="contador-error">
        {error}
      </p>
    );
  }

  if (!datos) {
    return <p className="text-sm text-neutral-600">Leyendo el contador…</p>;
  }

  const rancio = esRancio(datos.consumo.momento);

  return (
    <div className="flex flex-col gap-6" data-testid="contador-panel">
      <section className="grid gap-4 sm:grid-cols-3">
        <Dato titulo="Tareas del periodo" valor={etiquetaTareas(datos.consumo.tareas)} />
        <Dato titulo="Coste de modelos" valor={formatearEuros(datos.consumo.costeModelosEuros)} />
        <Dato titulo="Acciones auditadas" valor={formatearEntero(datos.consumo.acciones)} />
      </section>

      <p className="text-xs text-neutral-500">
        Periodo {datos.consumo.periodo} · anotación {formatearEntero(datos.consumo.ultimaAnotacion)}{' '}
        · leído {datos.consumo.momento}
        {rancio ? ' · el dato no es de ahora: la API no contesta' : ''}
      </p>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Coste por puesto</h2>
        {datos.porPuesto.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Todavía no hay consumo de modelos este periodo.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {datos.porPuesto.map((puesto) => (
              <li key={puesto.puestoId} className="flex justify-between border-b py-1">
                <span>{puesto.puesto}</span>
                <span className="font-mono">
                  {formatearEuros(puesto.costeModelosEuros)} ·{' '}
                  {formatearEntero(puesto.tokensEntrada + puesto.tokensSalida)} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Tareas raíz del periodo</h2>
        {datos.tareas.length === 0 ? (
          <p className="text-sm text-neutral-600">Ninguna tarea abierta este periodo.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {datos.tareas.map((tarea) => (
              <li key={tarea.tareaId} className="flex justify-between border-b py-1">
                <span>
                  {tarea.puesto} · {tarea.estado}
                  {tarea.delegaciones > 0
                    ? ` · ${formatearEntero(tarea.delegaciones)} delegadas`
                    : ''}
                </span>
                <span className="font-mono">{formatearEuros(tarea.costeModelosEuros)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Las delegaciones y las intervenciones no suman otra tarea: su consumo cuenta dentro de su
          tarea raíz (ADR-003).
        </p>
      </section>
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold">{valor}</p>
    </div>
  );
}
