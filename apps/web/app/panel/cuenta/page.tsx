/**
 * Cuenta de la persona: quién ha entrado, hasta cuándo, su passkey y la salida.
 */
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { accesoActivo, sesionDelPanel, urlDeLaApi } from '../../../lib/acceso';
import { perfilDelPanel } from '../../../lib/perfil';
import { VistaDeCuenta } from './vista';

export const dynamic = 'force-dynamic';

export default async function Cuenta() {
  if (!accesoActivo(process.env)) notFound();
  const apiUrl = urlDeLaApi(process.env);
  const galletas = await cookies();
  const cabeceraCookie = galletas.toString();
  const sesion = apiUrl ? await sesionDelPanel(apiUrl, cabeceraCookie, fetch) : null;
  if (!sesion) redirect('/acceso');
  const perfil = apiUrl ? await perfilDelPanel(apiUrl, cabeceraCookie, fetch) : null;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-12">
      <header>
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">Tu cuenta</p>
        <h1 className="text-3xl font-semibold">{sesion.nombre}</h1>
        <p className="text-neutral-600">{sesion.correo}</p>
      </header>
      <VistaDeCuenta caducaEn={sesion.caducaEn} mostrarPresenciaInicial={perfil?.mostrarPresencia ?? true} />
    </main>
  );
}
