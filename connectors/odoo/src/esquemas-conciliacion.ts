/**
 * Esquemas Zod del contrato de las dos herramientas de conciliación bancaria.
 *
 * Es el mismo contrato que sirve `connectors/demo` y el que sirve Factusol el
 * día que Factusol MCP tenga movimientos bancarios: una prueba compara la forma
 * de los esquemas entre conectores. Los identificadores son cadenas con el
 * identificador nativo del ERP, como en `connectors/factusol`. Ningún esquema
 * tiene campo de credencial.
 */
import { z } from 'zod';

import { FechaCalendario, Moneda } from './esquemas.js';

/** Importe con, como mucho, dos decimales. */
const DosDecimales = (valor: number): boolean =>
  Number.isFinite(valor) && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;

const Importe = z.number().refine(DosDecimales, 'El importe lleva como mucho dos decimales.');

/** Etiquetas HTML y entidades: el ERP las interpretaría. */
const HTML = /<[^>]*>|&[a-z]+;|&#\d+;/i;

export const EntradaLeerExtractoBancario = z
  .strictObject({
    cuenta_id: z.string().min(1).optional(),
    desde: FechaCalendario.optional(),
    hasta: FechaCalendario.optional(),
    solo_sin_casar: z.boolean().default(true),
    limite: z.number().int().min(1).max(200).default(50),
  })
  .superRefine((valor, contexto) => {
    if (valor.desde !== undefined && valor.hasta !== undefined && valor.hasta < valor.desde) {
      contexto.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: '«hasta» no puede ser anterior a «desde».',
      });
    }
  });

export const Apunte = z.object({
  id: z.string().min(1),
  cuenta_id: z.string().min(1),
  fecha: FechaCalendario,
  concepto: z.string(),
  importe: Importe,
  moneda: Moneda,
  casado: z.boolean(),
  documento_id: z.string().min(1).nullable(),
});

export const SalidaLeerExtractoBancario = z.object({
  apuntes: z.array(Apunte),
  total: z.number().int().min(0),
});

export const EntradaProponerAsientoDiferencia = z.strictObject({
  apunte_id: z.string().min(1),
  documento_id: z.string().min(1),
  importe_diferencia: Importe.refine((valor) => valor !== 0, 'La diferencia no puede ser cero.'),
  cuenta_contrapartida: z.string().min(1),
  motivo: z
    .string()
    .min(1, 'El motivo no puede estar vacío.')
    .max(500, 'El motivo no pasa de 500 caracteres.')
    .refine((valor) => !HTML.test(valor), 'El motivo va en texto plano, sin HTML.'),
  clave_idempotencia: z.string().min(1).max(200).optional(),
});

export const SalidaProponerAsientoDiferencia = z.object({
  id: z.string().min(1),
  apunte_id: z.string().min(1),
  estado: z.literal('borrador'),
  creado_en: z.string().datetime(),
});

export type EntradaExtracto = z.input<typeof EntradaLeerExtractoBancario>;
export type EntradaExtractoResuelta = z.output<typeof EntradaLeerExtractoBancario>;
export type SalidaExtracto = z.output<typeof SalidaLeerExtractoBancario>;
export type ApunteBancario = z.output<typeof Apunte>;
export type EntradaAsiento = z.input<typeof EntradaProponerAsientoDiferencia>;
export type EntradaAsientoResuelta = z.output<typeof EntradaProponerAsientoDiferencia>;
export type SalidaAsiento = z.output<typeof SalidaProponerAsientoDiferencia>;
