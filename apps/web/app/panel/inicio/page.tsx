/**
 * Inicio del panel, detrás de la bandera `AIW_INICIO_PANEL` (docs/specs/
 * inicio-panel-widgets-avisos.md). Sin ella, 404: la página no existe hasta que
 * se active para la demo, como el resto del panel.
 */
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { accesoActivo, sesionDelPanel, urlDeLaApi } from '../../../lib/acceso';
import { inicioActivo } from '../../../lib/inicio';
import { VistaDelInicio } from './vista';

export const dynamic = 'force-dynamic';

export default async function Inicio() {
  if (!inicioActivo(process.env)) notFound();

  let nombre = '';
  if (accesoActivo(process.env)) {
    const apiUrl = urlDeLaApi(process.env);
    const galletas = await cookies();
    const sesion = apiUrl ? await sesionDelPanel(apiUrl, galletas.toString(), fetch) : null;
    nombre = sesion?.nombre ?? '';
  }

  return <VistaDelInicio nombre={nombre} />;
}
