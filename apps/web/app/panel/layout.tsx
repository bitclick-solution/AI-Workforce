/**
 * Puerta del panel.
 *
 * Con `AIW_ACCESO_PANEL`, ninguna página de `/panel` se pinta sin una sesión que la
 * API dé por buena: sin ella, a `/acceso`. Esta comprobación es la de la interfaz;
 * la que protege los datos la hace la API en cada petición, fijando el tenant de la
 * sesión en la RLS.
 *
 * Sin la bandera, el panel se pinta como antes (la sala v1 con datos simulados) y
 * los datos reales no llegan, porque la API ya no acepta un tenant por cabecera.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { accesoActivo, sesionDelPanel, urlDeLaApi } from '../../lib/acceso';

export const dynamic = 'force-dynamic';

export default async function PuertaDelPanel({ children }: { children: ReactNode }) {
  if (accesoActivo(process.env)) {
    const apiUrl = urlDeLaApi(process.env);
    const galletas = await cookies();
    const sesion = apiUrl ? await sesionDelPanel(apiUrl, galletas.toString(), fetch) : null;
    if (!sesion) redirect('/acceso');
  }
  return children;
}
