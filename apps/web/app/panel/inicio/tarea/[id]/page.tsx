/**
 * Detalle de una tarea, detrás de la misma bandera que el Inicio
 * (`AIW_INICIO_PANEL`): es una pantalla del Inicio, no una funcionalidad aparte
 * (docs/specs/detalle-de-la-tarea-en-el-panel.md). Sin bandera, 404.
 */
import { notFound } from 'next/navigation';

import { inicioActivo } from '../../../../../lib/inicio';
import { VistaDelDetalle } from './vista';

export const dynamic = 'force-dynamic';

export default async function DetalleDeLaTarea({ params }: { params: Promise<{ id: string }> }) {
  if (!inicioActivo(process.env)) notFound();
  const { id } = await params;
  return <VistaDelDetalle tareaId={id} />;
}
