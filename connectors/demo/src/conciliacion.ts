/**
 * Contrato de conciliación bancaria y extracto de prueba.
 *
 * Los esquemas de este fichero son la referencia del contrato compartido con
 * `connectors/odoo`: una prueba compara su forma con la de Odoo. El extracto es
 * inventado, sin ninguna cuenta ni persona real.
 */
import { z } from 'zod';

import { FACTURAS_DEMO } from './datos.js';

/** Fecha de calendario `YYYY-MM-DD` que existe. */
export const FechaCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.')
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00.000Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
  }, 'La fecha no existe en el calendario.');

/** Código de moneda ISO 4217. */
export const Moneda = z.string().regex(/^[A-Z]{3}$/, 'La moneda va en ISO 4217, por ejemplo EUR.');

const DosDecimales = (valor: number): boolean =>
  Number.isFinite(valor) && Math.abs(valor * 100 - Math.round(valor * 100)) < 1e-6;

const Importe = z.number().refine(DosDecimales, 'El importe lleva como mucho dos decimales.');

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

export type ApunteDemo = z.output<typeof Apunte>;
export type EntradaExtractoDemo = z.output<typeof EntradaLeerExtractoBancario>;
export type EntradaAsientoDemo = z.output<typeof EntradaProponerAsientoDiferencia>;
export type SalidaAsientoDemo = z.output<typeof SalidaProponerAsientoDiferencia>;

/**
 * Extracto de prueba: cinco apuntes en dos cuentas, dos casados con una factura
 * de la cartera de cobros. Los tres sin casar son el caso del eval del puesto.
 */
export const APUNTES_DEMO: readonly ApunteDemo[] = [
  {
    id: 'apt-0001',
    cuenta_id: 'cta-001',
    fecha: '2026-09-03',
    concepto: 'TRANSF. PANADERIA LA ESPIGA F-2026-0002',
    importe: 318,
    moneda: 'EUR',
    casado: true,
    documento_id: 'inv-0002',
  },
  {
    id: 'apt-0002',
    cuenta_id: 'cta-001',
    fecha: '2026-09-12',
    concepto: 'TRANSF. CLINICA DENTAL SOROLLA F-2026-0003',
    importe: 2850.75,
    moneda: 'EUR',
    casado: false,
    documento_id: null,
  },
  {
    id: 'apt-0003',
    cuenta_id: 'cta-001',
    fecha: '2026-09-15',
    concepto: 'COMISION MANTENIMIENTO CUENTA',
    importe: -12,
    moneda: 'EUR',
    casado: false,
    documento_id: null,
  },
  {
    id: 'apt-0004',
    cuenta_id: 'cta-002',
    fecha: '2026-09-09',
    concepto: 'TRANSF. TALLERES MEDITERRANEO SL',
    importe: 1240.5,
    moneda: 'EUR',
    casado: true,
    documento_id: 'inv-0001',
  },
  {
    id: 'apt-0005',
    cuenta_id: 'cta-002',
    fecha: '2026-09-17',
    concepto: 'INGRESO SIN REFERENCIA',
    importe: 500,
    moneda: 'EUR',
    casado: false,
    documento_id: null,
  },
];

/** Cuentas contables válidas como contrapartida del asiento de diferencia. */
export const CUENTAS_CONTRAPARTIDA_DEMO: readonly string[] = ['629000', '669000', '759000'];

/** Extracto filtrado y ordenado del más antiguo al más reciente. */
export function extractoDemo(filtro: EntradaExtractoDemo): ApunteDemo[] {
  return APUNTES_DEMO.filter(
    (apunte) =>
      (filtro.cuenta_id === undefined || apunte.cuenta_id === filtro.cuenta_id) &&
      (filtro.desde === undefined || apunte.fecha >= filtro.desde) &&
      (filtro.hasta === undefined || apunte.fecha <= filtro.hasta) &&
      (!filtro.solo_sin_casar || !apunte.casado),
  )
    .map((apunte) => ({ ...apunte }))
    .sort((una, otra) =>
      una.fecha === otra.fecha ? una.id.localeCompare(otra.id) : una.fecha < otra.fecha ? -1 : 1,
    )
    .slice(0, filtro.limite);
}

export function buscarApunte(id: string): ApunteDemo | undefined {
  return APUNTES_DEMO.find((apunte) => apunte.id === id);
}

export function buscarDocumento(id: string): boolean {
  return FACTURAS_DEMO.some((factura) => factura.id === id);
}

/** Asiento en borrador guardado por la demo. Nunca pasa de ese estado. */
export interface AsientoGuardado {
  id: string;
  apunte_id: string;
  documento_id: string;
  importe_diferencia: number;
  cuenta_contrapartida: string;
  motivo: string;
  estado: 'borrador';
  creado_en: string;
}
