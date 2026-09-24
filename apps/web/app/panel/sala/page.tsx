/**
 * Sala general v0, detrás de la bandera `AIW_SALA_V0`. Sin bandera, 404.
 *
 * La referencia de interfaz es el prototipo de `/prototipo/sala`; esto no es su
 * código: aquí todo sale de la API y de los flujos del trabajador.
 */
import { notFound } from 'next/navigation';

import { salaActiva } from '../../../lib/sala';
import { VistaDeLaSala } from './vista';

export const dynamic = 'force-dynamic';

export default function PanelDeLaSala() {
  if (!salaActiva(process.env)) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Bitclick Solutions
        </p>
        <h1 className="text-3xl font-semibold">Sala general</h1>
        <p className="mt-2 text-neutral-700">
          Pregunta a tu equipo o pide un agente nuevo. El moderador decide quién responde y el
          Director de IA prepara las contrataciones para que las confirmes.
        </p>
      </header>
      <VistaDeLaSala />
    </main>
  );
}
