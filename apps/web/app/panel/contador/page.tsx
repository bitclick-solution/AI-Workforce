/**
 * Panel del contador de tareas v0, detrás de la bandera `AIW_PANEL_CONTADOR`.
 *
 * Sin bandera, la página no existe: `notFound()` y 404, que es lo que pide la lista
 * de hecho. La vista mínima de esta rebanada; el panel con gráficas y rangos de
 * fechas es «Panel v1».
 */
import { notFound } from 'next/navigation';

import { panelActivo } from '../../../lib/contador';
import { VistaDelContador } from './vista';

export const dynamic = 'force-dynamic';

export default function PanelDelContador() {
  if (!panelActivo(process.env)) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Bitclick Solutions
        </p>
        <h1 className="text-3xl font-semibold">Contador de tareas</h1>
        <p className="mt-2 text-neutral-700">
          Lo que ha trabajado tu equipo este periodo y lo que han costado los modelos, desde los
          usos reales.
        </p>
      </header>
      <VistaDelContador />
    </main>
  );
}
