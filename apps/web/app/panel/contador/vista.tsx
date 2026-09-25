'use client';

/**
 * Vista del contador. Sondea el proxy del servidor cada cinco segundos.
 *
 * El sondeo es temporal y está dicho en la especificación: los eventos ya se
 * escriben en `evento_salida`, y cuando exista el publicador hacia Centrifugo esta
 * vista cambia de sondeo a suscripción sin tocar la API ni el modelo. Mientras
 * tanto, `ultimaAnotacion` deja comparar un entero para saber si algo cambió.
 */
import { Aviso, Boton, Indicador } from '@aiw/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [reintentando, setReintentando] = useState(false);
  const vivo = useRef(true);

  const leer = useCallback(async () => {
    try {
      const respuesta = await fetch('/api/contador', { cache: 'no-store' });
      const cuerpo = (await respuesta.json()) as DatosDelContador & { error?: string };
      if (!vivo.current) return;
      if (!respuesta.ok) {
        setError(cuerpo.error ?? `El panel no pudo leer el contador (${respuesta.status}).`);
        return;
      }
      setDatos(cuerpo);
      setError(undefined);
    } catch {
      if (vivo.current) setError('El panel no pudo leer el contador.');
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    void leer();
    const temporizador = setInterval(() => void leer(), SONDEO_MS);
    return () => {
      vivo.current = false;
      clearInterval(temporizador);
    };
  }, [leer]);

  const reintentar = () => {
    setReintentando(true);
    void leer().finally(() => {
      setReintentando(false);
    });
  };

  if (error) {
    return (
      <div data-testid="contador-error">
        <Aviso
          tipo="error"
          titulo="El panel no pudo leer el contador"
          accion={
            <Boton tono="secundario" cargando={reintentando} onClick={reintentar}>
              Reintentar
            </Boton>
          }
        >
          {error}
        </Aviso>
      </div>
    );
  }

  if (!datos) {
    return <p className="text-sm text-texto-2">Leyendo el contador…</p>;
  }

  const rancio = esRancio(datos.consumo.momento);

  return (
    <div className="flex flex-col gap-6" data-testid="contador-panel">
      <section className="grid gap-4 sm:grid-cols-3">
        <Indicador etiqueta="Tareas del periodo" valor={etiquetaTareas(datos.consumo.tareas)} />
        <Indicador
          etiqueta="Coste de modelos"
          valor={formatearEuros(datos.consumo.costeModelosEuros)}
        />
        <Indicador etiqueta="Acciones auditadas" valor={formatearEntero(datos.consumo.acciones)} />
      </section>

      <p className="text-xs text-texto-3">
        Periodo {datos.consumo.periodo} · anotación {formatearEntero(datos.consumo.ultimaAnotacion)}{' '}
        · leído {datos.consumo.momento}
        {rancio ? ' · el dato no es de ahora: la API no contesta' : ''}
      </p>

      <section>
        <h2 className="mb-2 font-titulos text-lg font-semibold text-texto">Coste por puesto</h2>
        {datos.porPuesto.length === 0 ? (
          <p className="text-sm text-texto-2">Todavía no hay consumo de modelos este periodo.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {datos.porPuesto.map((puesto) => (
              <li key={puesto.puestoId} className="flex justify-between border-b border-linea py-1">
                <span className="text-texto">{puesto.puesto}</span>
                <span className="font-mono text-texto-2">
                  {formatearEuros(puesto.costeModelosEuros)} ·{' '}
                  {formatearEntero(puesto.tokensEntrada + puesto.tokensSalida)} tokens
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-titulos text-lg font-semibold text-texto">
          Tareas raíz del periodo
        </h2>
        {datos.tareas.length === 0 ? (
          <p className="text-sm text-texto-2">Ninguna tarea abierta este periodo.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {datos.tareas.map((tarea) => (
              <li key={tarea.tareaId} className="flex justify-between border-b border-linea py-1">
                <span className="text-texto">
                  {tarea.puesto} · {tarea.estado}
                  {tarea.delegaciones > 0
                    ? ` · ${formatearEntero(tarea.delegaciones)} delegadas`
                    : ''}
                </span>
                <span className="font-mono text-texto-2">
                  {formatearEuros(tarea.costeModelosEuros)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-texto-3">
          Las delegaciones y las intervenciones no suman otra tarea: su consumo cuenta dentro de su
          tarea raíz (ADR-003).
        </p>
      </section>
    </div>
  );
}
