/**
 * Sala del panel.
 *
 * - Con `AIW_SALA_V1`: la sala v1 estilo Discord (ADR-022), S2 en escritorio y
 *   S4 en el móvil, sobre el contrato de `lib/sala-contrato.ts`.
 * - Si no, con `AIW_SALA_V0`: la sala general v0, sin cambios.
 * - Sin ninguna de las dos, 404.
 *
 * La referencia de interfaz de la v0 es el prototipo de `/prototipo/sala`; esto no
 * es su código: aquí todo sale de la API y de los flujos del trabajador.
 */
import { notFound } from 'next/navigation';

import { salaActiva } from '../../../lib/sala';
import { salaV1Activa } from '../../../lib/sala-bandera';
import { SALA_INICIAL } from '../../../lib/sala-fuente';
import { VistaDeSalaV1 } from './_v1/vista';
import { VistaDeLaSala } from './vista';

export const dynamic = 'force-dynamic';

interface PropsDeLaPagina {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PanelDeLaSala({ searchParams }: PropsDeLaPagina) {
  if (salaV1Activa(process.env)) {
    const { sala } = await searchParams;
    const salaInicial = typeof sala === 'string' && sala.trim() ? sala : SALA_INICIAL;
    return <VistaDeSalaV1 salaInicial={salaInicial} />;
  }

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
