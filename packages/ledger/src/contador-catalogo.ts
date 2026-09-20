/**
 * Catálogo de tarifas: la puerta por la que un precio entra en la plataforma.
 *
 * Los precios son dato del tenant y no constantes del código (ADR-011: los importes
 * son hipótesis que se revisan). Este módulo no lleva ningún precio: valida el
 * catálogo que le pasan y lo convierte en altas para `registrarTarifa`. El fichero
 * de `src/datos/` es el catálogo de desarrollo y de pruebas; el real lo carga
 * Operación desde su propio fichero, con el mismo esquema.
 *
 * El cálculo del coste nunca lee de aquí: lee de `tarifa_modelo`. Si una tarifa no
 * se ha dado de alta, el uso falla, y eso es lo que se quiere.
 */
import { z } from 'zod';

import type { TarifaNueva } from './contador.js';

/** Ruta del catálogo de desarrollo. Solo para pruebas y scripts de operación. */
export const RUTA_CATALOGO_EJEMPLO = new URL('./datos/tarifas-ejemplo.json', import.meta.url);

const tarifaDelCatalogo = z.object({
  proveedor: z.string().trim().min(1),
  modelo: z.string().trim().min(1),
  eurosPorMillonEntrada: z.number().nonnegative(),
  eurosPorMillonSalida: z.number().nonnegative(),
  eurosPorMillonEntradaCache: z.number().nonnegative().default(0),
  /** ISO 8601. Se valida como fecha real y no solo como cadena con pinta de fecha. */
  vigenteDesde: z.string().refine((valor) => !Number.isNaN(Date.parse(valor)), {
    message: 'vigenteDesde no es una fecha ISO 8601',
  }),
  fuente: z.string().trim().min(1),
});

export const esquemaCatalogoTarifas = z.object({
  version: z.literal(1),
  nota: z.string().optional(),
  tarifas: z.array(tarifaDelCatalogo).min(1),
});

export type CatalogoTarifas = z.infer<typeof esquemaCatalogoTarifas>;

/**
 * Valida un catálogo y devuelve las altas listas para `registrarTarifa`.
 *
 * Un catálogo que no valida se rechaza entero: cargar la mitad de una lista de
 * precios deja al tenant con unos modelos tarifados y otros no, que es peor que no
 * cargar nada.
 */
export function tarifasDelCatalogo(json: unknown): TarifaNueva[] {
  const resultado = esquemaCatalogoTarifas.safeParse(json);
  if (!resultado.success) {
    throw new Error(
      `Catálogo de tarifas no válido: ${resultado.error.issues
        .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return resultado.data.tarifas.map((tarifa) => ({
    proveedor: tarifa.proveedor,
    modelo: tarifa.modelo,
    eurosPorMillonEntrada: tarifa.eurosPorMillonEntrada,
    eurosPorMillonSalida: tarifa.eurosPorMillonSalida,
    eurosPorMillonEntradaCache: tarifa.eurosPorMillonEntradaCache,
    vigenteDesde: new Date(tarifa.vigenteDesde),
    fuente: tarifa.fuente,
  }));
}
