'use client';

import { formatearDuracion, Insignia, useTraduccion } from '@aiw/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useRecorrido } from '../../lib/prototipo/contexto';
import { OBJETIVO_MINUTOS } from '../../lib/prototipo/datos';
import { transcurrido, type Hito } from '../../lib/prototipo/recorrido';

const PASOS: { hito: Hito; ruta: string; nombre: string }[] = [
  { hito: 'primerClic', ruta: '/prototipo', nombre: 'Empezar' },
  { hito: 'agenteContratado', ruta: '/prototipo/contratacion', nombre: 'Contratar' },
  { hito: 'intervencionPedida', ruta: '/prototipo/sala', nombre: 'Preguntar en la sala' },
  { hito: 'tareaAprobada', ruta: '/prototipo/aprobacion', nombre: 'Aprobar' },
];

const QUE_FALTA: Record<Hito, string> = {
  primerClic: 'Pulsa «Empezar» para arrancar el reloj.',
  agenteContratado: 'Falta contratar el agente.',
  intervencionPedida: 'Falta preguntar en la sala.',
  tareaAprobada: 'Falta aprobar la primera tarea.',
};

/**
 * Barra del recorrido: dónde estás, cuánto llevas y qué falta.
 * El reloj se enseña durante el recorrido y no solo al final; lo que interesa
 * medir no es el número, sino en qué paso se para la persona.
 */
export function BarraDelRecorrido() {
  const t = useTraduccion();
  const ruta = usePathname();
  const { recorrido } = useRecorrido();
  const [ahora, setAhora] = useState(() => Date.now());

  const empezado = recorrido.hitos.primerClic !== undefined;
  const terminado = recorrido.hitos.tareaAprobada !== undefined;

  useEffect(() => {
    if (!empezado || terminado) return;
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(reloj);
  }, [empezado, terminado]);

  const milisegundos = transcurrido(recorrido, ahora);
  const siguiente = PASOS.find((paso) => recorrido.hitos[paso.hito] === undefined);

  return (
    <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
            Prototipo · datos de ejemplo
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span role="timer" aria-live="off" data-testid="cronometro">
              <Insignia
                etiqueta="Tiempo"
                valor={milisegundos === null ? 'sin empezar' : formatearDuracion(milisegundos, t)}
                tono={terminado ? 'exito' : 'neutro'}
              />
            </span>
            <Insignia etiqueta="Objetivo" valor={`menos de ${OBJETIVO_MINUTOS} min`} />
            <Insignia etiqueta="Tareas" valor={String(recorrido.tareas)} />
          </div>
        </div>
        <nav aria-label="Pasos del prototipo">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {PASOS.map((paso, indice) => {
              const hecho = recorrido.hitos[paso.hito] !== undefined;
              const activo = ruta === paso.ruta;
              return (
                <li key={paso.hito} className="flex items-center gap-2">
                  {indice > 0 ? (
                    <span aria-hidden="true" className="text-neutral-300">
                      ›
                    </span>
                  ) : null}
                  <Link
                    href={paso.ruta}
                    aria-current={activo ? 'step' : undefined}
                    className={
                      activo
                        ? 'font-semibold text-neutral-900 underline underline-offset-4'
                        : 'text-neutral-600 hover:text-neutral-900'
                    }
                  >
                    {paso.nombre}
                    {hecho ? <span className="ml-1 text-emerald-700">(hecho)</span> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <p aria-live="polite" className="text-xs text-neutral-600" data-testid="que-falta">
          {siguiente === undefined
            ? 'Recorrido completo. Mira el resumen.'
            : QUE_FALTA[siguiente.hito]}
        </p>
      </div>
    </div>
  );
}
