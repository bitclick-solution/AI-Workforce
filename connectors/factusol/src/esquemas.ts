/**
 * Esquemas Zod del contrato de las dos herramientas.
 *
 * Es el mismo contrato que sirve el conector de demostración de la prueba
 * técnica (`connectors/demo`): el gateway cambia de servidor MCP sin tocar el
 * agente ni el caso dorado. Ningún esquema tiene campo de credencial, y esa
 * ausencia la comprueba una prueba.
 */
import { z } from 'zod';

/** Fecha de calendario, sin hora ni zona: la que imprime Factusol MCP. */
export const FechaCalendario = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.')
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00.000Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
  }, 'La fecha no existe en el calendario.');

/** Código de moneda ISO 4217: tres letras mayúsculas. */
export const Moneda = z.string().regex(/^[A-Z]{3}$/, 'La moneda va en ISO 4217, por ejemplo EUR.');

export const EntradaListarFacturasVencidas = z.strictObject({
  dias_vencida_minimo: z.number().int().min(0).default(1),
  limite: z.number().int().min(1).max(200).default(50),
});

/** Identificador nativo de Factusol, como cadena: `1-000123` en facturas, `12` en clientes. */
export const IdNativo = z.string().min(1).max(60);

export const Cliente = z.object({
  id: IdNativo,
  nombre: z.string().min(1),
});

export const Factura = z.object({
  id: IdNativo,
  numero: z.string().min(1),
  cliente: Cliente,
  importe_pendiente: z.number(),
  moneda: Moneda,
  fecha_emision: FechaCalendario,
  fecha_vencimiento: FechaCalendario,
  dias_vencida: z.number().int().positive(),
});

export const SalidaListarFacturasVencidas = z.object({
  facturas: z.array(Factura),
  total: z.number().int().min(0),
});

export const TIPOS_DE_NOTA = ['nota', 'actividad'] as const;

/** Etiquetas HTML y entidades: el panel de Factusol las interpretaría. */
const HTML = /<[^>]*>|&[a-z]+;|&#\d+;/i;

export const EntradaCrearNotaSeguimiento = z
  .strictObject({
    factura_id: IdNativo,
    texto: z
      .string()
      .min(1, 'El texto de la nota no puede estar vacío.')
      .max(2000, 'El texto de la nota no pasa de 2000 caracteres.')
      .refine((valor) => !HTML.test(valor), 'El texto de la nota va en texto plano, sin HTML.'),
    tipo: z.enum(TIPOS_DE_NOTA).default('nota'),
    fecha_limite: FechaCalendario.optional(),
    clave_idempotencia: z.string().min(1).max(200).optional(),
  })
  .superRefine((valor, contexto) => {
    if (valor.fecha_limite !== undefined && valor.tipo !== 'actividad') {
      contexto.addIssue({
        code: 'custom',
        path: ['fecha_limite'],
        message: 'La fecha límite solo vale con tipo «actividad».',
      });
    }
  });

export const SalidaCrearNotaSeguimiento = z.object({
  id: IdNativo,
  factura_id: IdNativo,
  tipo: z.enum(TIPOS_DE_NOTA),
  creado_en: z.string().datetime(),
});

export type EntradaListar = z.input<typeof EntradaListarFacturasVencidas>;
export type EntradaListarResuelta = z.output<typeof EntradaListarFacturasVencidas>;
export type SalidaListar = z.output<typeof SalidaListarFacturasVencidas>;
export type FacturaVencida = z.output<typeof Factura>;
export type EntradaNota = z.input<typeof EntradaCrearNotaSeguimiento>;
export type EntradaNotaResuelta = z.output<typeof EntradaCrearNotaSeguimiento>;
export type SalidaNota = z.output<typeof SalidaCrearNotaSeguimiento>;
export type TipoDeNota = (typeof TIPOS_DE_NOTA)[number];
