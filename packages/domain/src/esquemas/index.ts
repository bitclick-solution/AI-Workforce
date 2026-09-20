/**
 * Esquemas Zod de las cargas `jsonb`.
 *
 * Principio del ADR-007: columnas para todo lo que se filtra, ordena o relaciona;
 * `jsonb` con esquema validado para lo que varía. Nada escribe en una columna `jsonb`
 * sin pasar antes por el esquema de este módulo.
 */
import { z } from 'zod';

import { AMBITOS, NIVELES, PLANES, SENTIDOS_DECISION } from '../enumeraciones.js';

export { AMBITOS, NIVELES, PLANES, SENTIDOS_DECISION };

export const nivelAutonomia = z.enum(NIVELES);
export const ambito = z.enum(AMBITOS);
export const sentidoDecision = z.enum(SENTIDOS_DECISION);

/**
 * Plan comercial de la organización. Es una columna `text` y no un tipo `enum` de
 * PostgreSQL a propósito: el ADR-011 marca los planes como hipótesis que se revisa
 * al cierre de la fase 1, y cambiar esta lista no puede costar una migración.
 */
export const planOrganizacion = z.enum(PLANES);

/** Brand voice: la de rama hereda la general y la sobrescribe por campos, con versión. */
export const brandVoice = z.object({
  tono: z.string().optional(),
  tratamiento: z.enum(['tu', 'usted']).optional(),
  prohibiciones: z.array(z.string()).optional(),
  ejemplos: z.array(z.string()).optional(),
  version: z.number().int().positive().optional(),
});

export const limitesOrganizacion = z.object({
  tareasPorMes: z.number().int().nonnegative().optional(),
  agentesActivos: z.number().int().nonnegative().optional(),
  costeMensualEuros: z.number().nonnegative().optional(),
});

export const politicaCruceDepartamentos = z.object({
  permitido: z.boolean().default(false),
  paresPermitidos: z.array(z.tuple([z.string(), z.string()])).default([]),
  requiereAprobacion: z.boolean().default(true),
});

/** Nivel por clase de acción. La clase la define el registro de herramientas. */
export const nivelesPorClase = z.record(z.string(), nivelAutonomia);

/** Política versionada de un puesto: lo que congelaba la versión cuando el agente actuó. */
export const politicaPuesto = z.object({
  niveles: nivelesPorClase.default({}),
  presupuestoPorTareaEuros: z.number().nonnegative().optional(),
  guardiasEntrada: z.array(z.string()).default([]),
  guardiasSalida: z.array(z.string()).default([]),
  clasesProhibidas: z.array(z.string()).default([]),
});

/** Borrador de aprobación: carga opaca para el plano de control (ADR-001). */
export const borradorOpaco = z.object({
  tipo: z.string(),
  /** El plano de control no interpreta este contenido; lo entiende quien lo ejecuta. */
  carga: z.unknown(),
  huella: z.string().optional(),
});

export const formatoDelegacion = z.object({
  formato: z.enum(['texto', 'json', 'tabla', 'documento']),
  esquema: z.unknown().optional(),
  criteriosAceptacion: z.array(z.string()).default([]),
});

export const contenidoSenal = z.object({
  resumen: z.string(),
  detalle: z.record(z.string(), z.unknown()).default({}),
  puntuacion: z.number().min(-1).max(1).optional(),
});

/** El aprendizaje se acota a memoria, habilidades, parámetros en rango y ejemplos. */
export const parametrosLeccion = z.object({
  clase: z.enum(['memoria', 'habilidad', 'parametro', 'ejemplo']),
  destino: z.string(),
  valor: z.unknown(),
  rango: z.tuple([z.number(), z.number()]).optional(),
});

export const umbralesIndicador = z.object({
  aviso: z.number().optional(),
  alerta: z.number().optional(),
  direccion: z.enum(['mayor_mejor', 'menor_mejor']).default('mayor_mejor'),
});

export const identificadoresEntidad = z.record(z.string(), z.string());

export const cargaEventoSalida = z.object({
  version: z.number().int().positive().default(1),
  datos: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Datos referenciados por una entrada de auditoría: tipo e identificador, nunca la
 * carga completa. Así la entrada sobrevive a purgas y archivados.
 */
export const datosReferenciados = z.array(
  z.object({
    tipo: z.string(),
    id: z.string(),
    sistema: z.string().optional(),
  }),
);

export type BrandVoice = z.infer<typeof brandVoice>;
export type PoliticaPuesto = z.infer<typeof politicaPuesto>;
export type BorradorOpaco = z.infer<typeof borradorOpaco>;
export type ParametrosLeccion = z.infer<typeof parametrosLeccion>;
export type DatosReferenciados = z.infer<typeof datosReferenciados>;
export type PlanOrganizacion = z.infer<typeof planOrganizacion>;
export type SentidoDecision = z.infer<typeof sentidoDecision>;

/** Valida una carga antes de escribirla en una columna `jsonb`. Lanza con el detalle. */
export function validarCarga<T>(esquema: z.ZodType<T>, valor: unknown, dondeEscribe: string): T {
  const resultado = esquema.safeParse(valor);
  if (!resultado.success) {
    throw new Error(
      `Carga jsonb no válida para ${dondeEscribe}: ${resultado.error.issues
        .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return resultado.data;
}
