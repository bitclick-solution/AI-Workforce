/**
 * Entrar al panel: enlace por correo o passkey.
 *
 * Solo existe con `AIW_ACCESO_PANEL`. No hay registro: quien no está invitado pide
 * un enlace, recibe la misma respuesta que los demás y no le llega nada.
 */
import { notFound } from 'next/navigation';

import { accesoActivo } from '../../lib/acceso';
import { VistaDeAcceso } from './vista';

export const dynamic = 'force-dynamic';

interface PropsDeLaPagina {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Acceso({ searchParams }: PropsDeLaPagina) {
  if (!accesoActivo(process.env)) notFound();
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">AI Workforce</p>
        <h1 className="text-3xl font-semibold">Entrar al panel</h1>
      </header>
      <VistaDeAcceso error={typeof error === 'string' ? error : undefined} />
    </main>
  );
}
