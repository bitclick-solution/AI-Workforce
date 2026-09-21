/**
 * Cartera de facturas de prueba. Datos inventados, ninguna persona real.
 *
 * El conector de demostración expone las mismas dos herramientas que el conector
 * de Odoo, así que la prueba técnica y la integración continua no dependen de tener
 * acceso a Odoo. Cuando el conector real exista, el gateway cambia de servidor y el
 * resto de la plataforma no se entera: eso es justo lo que se está demostrando.
 *
 * Hay cinco facturas y solo tres vencidas. Las dos que no lo están son el caso
 * negativo del eval del puesto: un agente que propone una nota para una factura al
 * día no está haciendo su trabajo, está haciendo ruido.
 */
export interface FacturaDemo {
  numero: string;
  cliente: string;
  importeEuros: number;
  /** Fecha de vencimiento en ISO 8601, sin hora. */
  vence: string;
  moneda: 'EUR';
}

/** Fecha con la que se calculan los vencimientos de la cartera de prueba. */
export const HOY_DEMO = '2026-09-21';

export const FACTURAS_DEMO: readonly FacturaDemo[] = [
  {
    numero: 'F-2026-0001',
    cliente: 'Talleres Mediterráneo, S.L.',
    importeEuros: 1240.5,
    vence: '2026-08-15',
    moneda: 'EUR',
  },
  {
    numero: 'F-2026-0002',
    cliente: 'Panadería La Espiga',
    importeEuros: 318,
    vence: '2026-09-01',
    moneda: 'EUR',
  },
  {
    numero: 'F-2026-0003',
    cliente: 'Clínica Dental Sorolla',
    importeEuros: 2860.75,
    vence: '2026-09-10',
    moneda: 'EUR',
  },
  {
    numero: 'F-2026-0004',
    cliente: 'Gestoría Ribera',
    importeEuros: 540,
    vence: '2026-10-05',
    moneda: 'EUR',
  },
  {
    numero: 'F-2026-0005',
    cliente: 'Hotel Marina Alta',
    importeEuros: 7420.1,
    vence: '2026-11-30',
    moneda: 'EUR',
  },
];

/** Las vencidas a una fecha. Comparación por cadena: las dos son ISO 8601 sin hora. */
export function facturasVencidas(aFecha: string = HOY_DEMO): readonly FacturaDemo[] {
  return FACTURAS_DEMO.filter((factura) => factura.vence < aFecha);
}

export function buscarFactura(numero: string): FacturaDemo | undefined {
  return FACTURAS_DEMO.find((factura) => factura.numero === numero);
}

/** Días de retraso de una factura a una fecha. Cero si aún no ha vencido. */
export function diasDeRetraso(factura: FacturaDemo, aFecha: string = HOY_DEMO): number {
  const dia = 24 * 60 * 60 * 1000;
  const retraso = Math.floor((Date.parse(aFecha) - Date.parse(factura.vence)) / dia);
  return retraso > 0 ? retraso : 0;
}
