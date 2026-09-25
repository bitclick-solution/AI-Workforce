/**
 * Esquemas Zod de las cargas `jsonb`.
 *
 * Principio del ADR-007: columnas para todo lo que se filtra, ordena o relaciona;
 * `jsonb` con esquema validado para lo que varía. Nada escribe en una columna `jsonb`
 * sin pasar antes por el esquema de este módulo.
 */
import { z } from 'zod';

import {
  AMBITOS,
  CLASES_PASO,
  NIVELES,
  NIVELES_ESFUERZO,
  PAPELES_MODELO,
  PLANES,
  SENTIDOS_DECISION,
} from '../enumeraciones.js';

export {
  AMBITOS,
  CLASES_PASO,
  NIVELES,
  NIVELES_ESFUERZO,
  PAPELES_MODELO,
  PLANES,
  SENTIDOS_DECISION,
};

export const nivelAutonomia = z.enum(NIVELES);
export const ambito = z.enum(AMBITOS);
export const sentidoDecision = z.enum(SENTIDOS_DECISION);
export const papelModelo = z.enum(PAPELES_MODELO);
export const claseDePaso = z.enum(CLASES_PASO);
export const nivelEsfuerzo = z.enum(NIVELES_ESFUERZO);

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

/**
 * Configuración de modelo de una versión de puesto (ADR-018): modelo, esfuerzo por
 * clase de paso y modelo de respaldo. Es dato inmutable de la versión, igual que la
 * política: cambiar de modelo o de esfuerzo por defecto es una promoción y crea una
 * versión nueva, nunca una edición de esta.
 *
 * `modeloRespaldo` puede repetir `modelo`: significa que el puesto no tiene
 * respaldo real y una tarea con rechazo del clasificador falla como paso no
 * reintentable sin segundo intento (ADR-018). No hay respaldo de servidor en
 * Bedrock ni en Vertex: lo ejecuta el cliente.
 */
export const configuracionModeloPuesto = z.object({
  modelo: papelModelo,
  modeloRespaldo: papelModelo.nullable().default(null),
  esfuerzoPorClasePaso: z.partialRecord(claseDePaso, nivelEsfuerzo).default({}),
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

/**
 * Edición del borrador antes de aprobar, en `decision_aprobacion.edicion_previa`:
 * la carga que propuso el agente y la que aprobó la persona. Las dos son opacas
 * (ADR-001); el aprendizaje solo compara sus rutas.
 */
export const edicionBorrador = z
  .object({ antes: z.unknown(), despues: z.unknown() })
  .refine((valor) => valor.antes !== undefined && valor.despues !== undefined, {
    message: 'la edición necesita la carga de antes y la de después',
  });

/**
 * Memoria congelada de una versión de puesto: las líneas que su prompt incluye bajo
 * «Lo que ya sabes», cada una con la lección que la originó. Una versión anterior a
 * esta forma guarda `{}`, que se lee como memoria vacía.
 */
export const memoriaCongelada = z.object({
  lineas: z.array(z.object({ leccionId: z.string().min(1), texto: z.string().min(1) })).default([]),
});

/** Lección que origina una versión de puesto, en `version_puesto.lecciones_origen`. */
export const leccionesOrigen = z.array(
  z.object({
    leccionId: z.string().min(1),
    senalIds: z.array(z.string().min(1)).default([]),
    promocionadaPorPersonaId: z.string().min(1),
  }),
);

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
 *
 * Los dos campos obligatorios no admiten cadena vacía: una referencia sin tipo o sin
 * identificador no sirve para reconstruir nada, que es lo único que hace falta que
 * sirva dentro de seis años.
 */
export const datosReferenciados = z.array(
  z.object({
    tipo: z.string().min(1),
    id: z.string().min(1),
    sistema: z.string().min(1).optional(),
  }),
);

/**
 * Cambio de nivel de autonomía que anota una entrada de auditoría: qué clase de
 * acción, de qué nivel a qué nivel y por qué. El nivel de origen es nulo cuando la
 * clase no tenía nivel asignado todavía.
 *
 * Lo normal es que una acción no cambie ningún nivel; entonces la columna es nula y
 * no hay nada que validar.
 */
export const cambioDeNivel = z.object({
  claseAccion: z.string().min(1),
  de: nivelAutonomia.nullable(),
  a: nivelAutonomia,
  motivo: z.string().min(1).optional(),
  propuestaOperacionId: z.string().min(1).optional(),
});

export type BrandVoice = z.infer<typeof brandVoice>;
export type PoliticaPuesto = z.infer<typeof politicaPuesto>;
export type ConfiguracionModeloPuesto = z.infer<typeof configuracionModeloPuesto>;
export type BorradorOpaco = z.infer<typeof borradorOpaco>;
export type ParametrosLeccion = z.infer<typeof parametrosLeccion>;
export type EdicionBorrador = z.infer<typeof edicionBorrador>;
export type MemoriaCongelada = z.infer<typeof memoriaCongelada>;
export type LeccionesOrigen = z.infer<typeof leccionesOrigen>;
export type DatosReferenciados = z.infer<typeof datosReferenciados>;
export type CambioDeNivel = z.infer<typeof cambioDeNivel>;
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
