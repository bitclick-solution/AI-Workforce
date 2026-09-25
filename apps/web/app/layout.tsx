import { cn } from '@aiw/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import { bricolageGrotesque, figtree } from './fuentes';

export const metadata: Metadata = {
  title: 'AI Workforce',
  description: 'Equipos de agentes de IA para la pyme, gobernados y con auditoría completa.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={cn(bricolageGrotesque.variable, figtree.variable)}>
      <body className="min-h-screen bg-fondo font-texto text-texto antialiased">{children}</body>
    </html>
  );
}
