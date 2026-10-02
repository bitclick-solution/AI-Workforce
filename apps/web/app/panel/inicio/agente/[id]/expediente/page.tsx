/**
 * Expediente de un agente, detrás de la misma bandera que el Inicio
 * (`AIW_INICIO_PANEL`): es una pantalla del Inicio, no una funcionalidad aparte
 * (docs/specs/expediente-por-agente-n0-n1.md). Sin bandera, 404.
 */
import { notFound } from 'next/navigation';

import { inicioActivo } from '../../../../../../lib/inicio';
import { VistaDelExpediente } from './vista';

export const dynamic = 'force-dynamic';

export default async function ExpedienteDelAgente({ params }: { params: Promise<{ id: string }> }) {
  if (!inicioActivo(process.env)) notFound();
  const { id } = await params;
  return <VistaDelExpediente puestoId={id} />;
}
