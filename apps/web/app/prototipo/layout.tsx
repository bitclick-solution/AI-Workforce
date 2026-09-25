import { ProveedorDeIdioma } from '@aiw/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ProveedorDelRecorrido } from '../../lib/prototipo/contexto';
import { BarraDelRecorrido } from './barra';

export const metadata: Metadata = {
  title: 'Prototipo · AI Workforce',
  description:
    'Prototipo navegable de la contratación desde una frase, la sala general y la aprobación móvil. Datos de ejemplo.',
};

export default function DisposicionDelPrototipo({ children }: { children: ReactNode }) {
  return (
    <ProveedorDeIdioma idioma="es">
      <ProveedorDelRecorrido>
        <div className="min-h-screen bg-neutral-50">
          <BarraDelRecorrido />
          <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8">{children}</main>
        </div>
      </ProveedorDelRecorrido>
    </ProveedorDeIdioma>
  );
}
