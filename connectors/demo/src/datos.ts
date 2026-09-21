/**
 * Cartera de facturas de prueba. Datos inventados, ninguna persona real.
 *
 * Los nombres de los campos son los del contrato que comparten este conector y
 * «Conector Odoo v0»: en el contrato van en minúsculas con guion bajo porque es lo
 * que devuelve el ERP y lo que el modelo ve. Dentro del código de la plataforma se
 * escribe en camello; la traducción, si hace falta, la hace quien consume.
 *
 * Hay cinco facturas y solo tres vencidas. Las dos que no lo están son el caso
 * negativo del eval del puesto: un agente que propone una nota para una factura al
 * día no está haciendo su trabajo, está haciendo ruido.
 */

/** Factura tal como la publica el contrato de `listar_facturas_vencidas`. */
export interface FacturaDemo {
  /** Identificador en el sistema de gestión. Es lo que pide `crear_nota_seguimiento`. */
  id: string;
  numero: string;
  cliente: { id: string; nombre: string };
  importe_pendiente: number;
  /** Moneda en ISO 4217. */
  moneda: string;
  /** Fecha de emisión en `YYYY-MM-DD`. */
  fecha_emision: string;
  /** Fecha de vencimiento en `YYYY-MM-DD`. */
  fecha_vencimiento: string;
}

/** Factura con los días vencida ya calculados, como sale de la herramienta. */
export interface FacturaVencida extends FacturaDemo {
  dias_vencida: number;
}

/** Fecha con la que se calculan los vencimientos de la cartera de prueba. */
export const HOY_DEMO = '2026-09-21';

export const FACTURAS_DEMO: readonly FacturaDemo[] = [
  {
    id: 'inv-0001',
    numero: 'F-2026-0001',
    cliente: { id: 'cli-001', nombre: 'Talleres Mediterráneo, S.L.' },
    importe_pendiente: 1240.5,
    moneda: 'EUR',
    fecha_emision: '2026-07-16',
    fecha_vencimiento: '2026-08-15',
  },
  {
    id: 'inv-0002',
    numero: 'F-2026-0002',
    cliente: { id: 'cli-002', nombre: 'Panadería La Espiga' },
    importe_pendiente: 318,
    moneda: 'EUR',
    fecha_emision: '2026-08-02',
    fecha_vencimiento: '2026-09-01',
  },
  {
    id: 'inv-0003',
    numero: 'F-2026-0003',
    cliente: { id: 'cli-003', nombre: 'Clínica Dental Sorolla' },
    importe_pendiente: 2860.75,
    moneda: 'EUR',
    fecha_emision: '2026-08-11',
    fecha_vencimiento: '2026-09-10',
  },
  {
    id: 'inv-0004',
    numero: 'F-2026-0004',
    cliente: { id: 'cli-004', nombre: 'Gestoría Ribera' },
    importe_pendiente: 540,
    moneda: 'EUR',
    fecha_emision: '2026-09-05',
    fecha_vencimiento: '2026-10-05',
  },
  {
    id: 'inv-0005',
    numero: 'F-2026-0005',
    cliente: { id: 'cli-005', nombre: 'Hotel Marina Alta' },
    importe_pendiente: 7420.1,
    moneda: 'EUR',
    fecha_emision: '2026-10-31',
    fecha_vencimiento: '2026-11-30',
  },
];

const DIA_EN_MS = 24 * 60 * 60 * 1000;

/** Días vencida de una factura a una fecha. Cero o menos si aún no ha vencido. */
export function diasVencida(factura: FacturaDemo, aFecha: string = HOY_DEMO): number {
  return Math.floor((Date.parse(aFecha) - Date.parse(factura.fecha_vencimiento)) / DIA_EN_MS);
}

export interface FiltroDeVencidas {
  /** Mínimo de días vencida. Uno por defecto: al día no es vencida. */
  diasVencidaMinimo?: number | undefined;
  limite?: number | undefined;
  aFecha?: string | undefined;
}

/**
 * Las facturas vencidas, de más a menos días vencida.
 *
 * El orden es parte del contrato: la nota más urgente es la de la factura que lleva
 * más tiempo sin pagarse, y un agente que recorta la lista por el límite tiene que
 * quedarse con las de arriba.
 */
export function facturasVencidas(filtro: FiltroDeVencidas = {}): FacturaVencida[] {
  const minimo = filtro.diasVencidaMinimo ?? 1;
  const limite = filtro.limite ?? 50;
  const aFecha = filtro.aFecha ?? HOY_DEMO;

  return FACTURAS_DEMO.map((factura) => ({
    ...factura,
    dias_vencida: diasVencida(factura, aFecha),
  }))
    .filter((factura) => factura.dias_vencida >= Math.max(1, minimo))
    .sort((una, otra) => otra.dias_vencida - una.dias_vencida)
    .slice(0, limite);
}

/** Busca por identificador o por número: el agente puede tener cualquiera de los dos. */
export function buscarFactura(referencia: string): FacturaDemo | undefined {
  return FACTURAS_DEMO.find(
    (factura) => factura.id === referencia || factura.numero === referencia,
  );
}
