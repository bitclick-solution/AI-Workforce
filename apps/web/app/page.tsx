import { Estado } from '@aiw/ui';

import { estadoCimientos } from '../lib/cimientos';

export default function Inicio() {
  const estado = estadoCimientos();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
          Bitclick Solutions
        </p>
        <h1 className="text-4xl font-semibold">AI Workforce</h1>
        <p className="mt-2 text-neutral-700">
          Equipos de agentes de IA que trabajan dentro de los sistemas de la empresa, piden permiso
          antes de tocar nada importante y dejan constancia de todo.
        </p>
      </header>
      <Estado titulo={estado.titulo} data-testid="estado-cimientos">
        <ul className="list-disc pl-5">
          {estado.piezas.map((pieza) => (
            <li key={pieza}>{pieza}</li>
          ))}
        </ul>
      </Estado>
    </main>
  );
}
