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
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Sala general</h1>
        <p className="text-sm text-neutral-500">
          El moderador decide quién responde; el Director de IA prepara las contrataciones.
        </p>
      </header>
      <VistaDeLaSala />
    </main>
  );
}
