/**
 * Expediente por agente: contrato con la API y ruta en el panel.
 *
 * Igual que `inicio.ts`, los tipos son una copia declarada del contrato JSON de
 * `apps/api/src/rutas/expediente.ts`, no un `import`: meter `@aiw/db` en el bundle
 * del panel arrastraría el driver de PostgreSQL.
 */
import { pedirJson, type Buscador } from './inicio';

export type NivelDeAutonomia = 'n0' | 'n1' | 'n2' | 'n3';

export interface CambioDeNivelDelExpediente {
  claseAccion: string;
  de: NivelDeAutonomia | null;
  a: NivelDeAutonomia | null;
  versionPuestoId: string;
  numeroVersion: number;
  fecha: string;
  leccionId: string | null;
  decididaPorPersonaId: string | null;
}

export interface CriterioNumerico {
  actual: number | null;
  requerido: number;
  cumplido: boolean;
}

export interface AvanceHaciaElAscenso {
  de: NivelDeAutonomia;
  a: NivelDeAutonomia;
  acciones: CriterioNumerico;
  aprobadasSinCambiosPct: CriterioNumerico;
  diasSinIncidentes: CriterioNumerico;
  confirmacion: { confirmada: boolean; cumplido: boolean };
  cumplidos: number;
  total: 4;
}

export type MotivoSinAscenso = 'fijo' | 'prohibida' | 'nivel_maximo' | 'sin_criterio';

export interface ClaseDelExpediente {
  claseAccion: string;
  nivel: NivelDeAutonomia | null;
  prohibida: boolean;
  ascenso: AvanceHaciaElAscenso | null;
  sinAscenso: MotivoSinAscenso | null;
  historial: CambioDeNivelDelExpediente[];
}

export interface VersionDelExpediente {
  versionPuestoId: string;
  numero: number;
  creadaEn: string;
  niveles: Record<string, NivelDeAutonomia>;
  clasesProhibidas: string[];
  lecciones: string[];
}

export interface LeccionDelExpediente {
  leccionId: string;
  titulo: string;
  linea: string;
  estado: 'propuesta' | 'vigente' | 'retirada';
  promocionId: string | null;
  versionPuestoId: string | null;
}

export interface AccionRechazadaDelExpediente {
  numeroOrden: number;
  tareaId: string | null;
  claseAccion: string;
  herramienta: string | null;
  nivel: NivelDeAutonomia | null;
  costeEuros: number;
  porque: string | null;
  creadoEn: string;
}

export interface ExpedienteDelPuesto {
  puestoId: string;
  nombre: string;
  departamento: string;
  estado: string;
  versionActiva: { versionPuestoId: string; numero: number } | null;
  versiones: VersionDelExpediente[];
  clases: ClaseDelExpediente[];
  lecciones: LeccionDelExpediente[];
  rechazadas: AccionRechazadaDelExpediente[];
  totalRechazadas: number;
}

/** Dónde vive el expediente de un agente en el panel. */
export function rutaDelExpediente(puestoId: string): string {
  return `/panel/inicio/agente/${encodeURIComponent(puestoId)}/expediente`;
}

export async function leerExpedienteDelPuesto(
  puestoId: string,
  buscar: Buscador = fetch,
): Promise<ExpedienteDelPuesto> {
  const { expediente } = await pedirJson<{ expediente: ExpedienteDelPuesto }>(
    `/api/puestos/${encodeURIComponent(puestoId)}/expediente`,
    {},
    buscar,
  );
  return expediente;
}
