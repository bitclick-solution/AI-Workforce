/**
 * Vencimiento de una factura, derivado de su forma de pago.
 *
 * Factusol MCP no trae el vencimiento: `get_factura` declara la forma de pago
 * (`- Forma de pago: COD · NOMBRE`) y `get_formas_de_pago` da, por código, el nombre y el
 * número de vencimientos. Los días solo van **dentro del nombre** («RECIBO A 30 DIAS»), así
 * que el mapa nombre→días es una tabla de patrones. Lo que no encaja —varios vencimientos,
 * un nombre sin días, un código desconocido— no se deriva: la factura no se devuelve y se
 * cuenta en el registro. Nunca se supone un plazo.
 */
import { analizarFormasDePago, type DetalleDeFactura } from './markdown.js';

export interface ResolutorDeVencimiento {
  derivar(factura: DetalleDeFactura): Promise<string | undefined>;
}

/** No deriva nada: todas las facturas se descartan y se cuentan. */
export const sinVencimiento: ResolutorDeVencimiento = {
  derivar: () => Promise.resolve(undefined),
};

/** Días de plazo que dice el nombre de una forma de un solo vencimiento, o `undefined`. */
export function diasDePlazo(nombre: string, vencimientos: number): number | undefined {
  if (vencimientos !== 1) return undefined;
  if (/^CONTADO$/i.test(nombre.trim())) return 0;
  const coincide = /\b(\d{1,3})\s*D[IÍ]AS\b/i.exec(nombre);
  return coincide === null ? undefined : Number(coincide[1]);
}

function sumarDias(fecha: string, dias: number): string {
  const resultado = new Date(`${fecha}T00:00:00.000Z`);
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado.toISOString().slice(0, 10);
}

/** Resolutor sobre `get_formas_de_pago`, que se lee una sola vez por resolutor. */
export function resolutorPorFormaDePago(leerFormas: () => Promise<string>): ResolutorDeVencimiento {
  let formas: Promise<ReturnType<typeof analizarFormasDePago>> | undefined;
  return {
    async derivar(factura) {
      if (factura.formaDePago === undefined) return undefined;
      formas ??= leerFormas().then(analizarFormasDePago);
      let tabla;
      try {
        tabla = await formas;
      } catch (error) {
        formas = undefined;
        throw error;
      }
      const forma = tabla.get(factura.formaDePago.codigo);
      if (forma === undefined) return undefined;
      const dias = diasDePlazo(forma.nombre, forma.vencimientos);
      return dias === undefined ? undefined : sumarDias(factura.fecha, dias);
    },
  };
}
