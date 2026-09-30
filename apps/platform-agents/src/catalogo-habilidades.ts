/**
 * Esquema y carga de `catalogo/habilidades.json`.
 *
 * Mecanismo, no contenido: esta rebanada fija la forma de una habilidad del
 * catálogo y valida el fichero contra ella, pero el catálogo llega vacío. Las
 * nueve habilidades de Finanzas para España son una rebanada de contenido aparte
 * (docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md, decisión 1): cada
 * cifra, plazo y fecha normativa se escribe contra el texto oficial vigente
 * (BOE, AEAT, AEB, Banco de España) verificado en esa sesión, nunca de memoria.
 *
 * `fuentes` vive solo aquí, en el dato del repositorio: la fila `habilidad` de la
 * base no tiene columna para ella (decisión 1 de la especificación — sin
 * migración), así que quien quiera saber de dónde sale una cifra lee este fichero
 * y no la base.
 */
import { z } from 'zod';

import catalogoDeHabilidades from './catalogo/habilidades.json' with { type: 'json' };

export const fuenteDeHabilidad = z.object({
  titulo: z.string().min(1),
  url: z.string().min(1),
});

/**
 * Una habilidad del catálogo. `herramientas` son los nombres de herramienta que
 * sus pasos nombran: la puerta del Evaluador los compara con la lista blanca del
 * puesto antes de activarla (decisión 4). `fuentes` es obligatoria cuando el
 * contenido es normativo — la especificación lo pide para Cobros y Previsión —
 * pero el esquema no puede saber cuál lo es, así que la exige siempre que
 * `normativa` es cierto.
 */
export const habilidadDelCatalogo = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    puesto: z.enum(['cobros', 'conciliacion', 'prevision']),
    nombre: z.string().min(1),
    casosQueAplican: z.array(z.string().min(1)).min(1),
    pasos: z.array(z.string().min(1)).min(1),
    comprobaciones: z.array(z.string().min(1)).min(1),
    herramientas: z.array(z.string().min(1)).default([]),
    normativa: z.boolean().default(false),
    fuentes: z.array(fuenteDeHabilidad).default([]),
  })
  .refine((habilidad) => !habilidad.normativa || habilidad.fuentes.length > 0, {
    message: 'una habilidad normativa tiene que citar al menos una fuente oficial',
  });

export const catalogoHabilidades = z.object({
  version: z.number().int().positive(),
  fuente: z.string().min(1),
  nota: z.string().optional(),
  habilidades: z.array(habilidadDelCatalogo).default([]),
});

export type HabilidadDelCatalogo = z.infer<typeof habilidadDelCatalogo>;
export type CatalogoHabilidades = z.infer<typeof catalogoHabilidades>;

/** El catálogo validado. Un JSON que no cumple el esquema no llega a cargarse. */
export const CATALOGO_DE_HABILIDADES: CatalogoHabilidades = catalogoHabilidades.parse(
  catalogoDeHabilidades,
);
