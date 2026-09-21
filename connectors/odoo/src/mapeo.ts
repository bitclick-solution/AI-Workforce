/**
 * Mapeo entre los campos de Odoo y el contrato del conector.
 *
 * Odoo devuelve los campos relación como par `[id, nombre]` con XML-RPC y como
 * objeto `{ id, display_name }` con JSON-2, y un campo vacío como `false`. El
 * MCP dinámico pasa la forma tal cual, así que las dos se aceptan aquí y en un
 * único sitio.
 */
import { ErrorConector } from './errores.js';
import { Factura, type FacturaVencida } from './esquemas.js';

/** Campos de `account.move` que pide el conector. Ni uno más. */
export const CAMPOS_FACTURA = [
  'name',
  'partner_id',
  'amount_residual',
  'currency_id',
  'invoice_date',
  'invoice_date_due',
] as const;

export interface Relacion {
  readonly id: number;
  readonly nombre: string;
}

const MILISEGUNDOS_POR_DIA = 86_400_000;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function fallo(mensaje: string): never {
  throw new ErrorConector('invalido', `La respuesta del ERP no encaja en el contrato: ${mensaje}`);
}

/** `[7, "Ferretería Ejemplo SA"]`, `{ id: 7, display_name: "…" }` o `false`. */
export function leerRelacion(valor: unknown, campo: string): Relacion {
  if (Array.isArray(valor) && typeof valor[0] === 'number' && typeof valor[1] === 'string') {
    return { id: valor[0], nombre: valor[1] };
  }
  if (esObjeto(valor)) {
    const id = valor['id'];
    const nombre = valor['display_name'] ?? valor['name'];
    if (typeof id === 'number' && typeof nombre === 'string') return { id, nombre };
  }
  return fallo(`el campo «${campo}» no es una relación de Odoo`);
}

function leerTexto(valor: unknown, campo: string): string {
  if (typeof valor === 'string' && valor.trim() !== '') return valor;
  return fallo(`el campo «${campo}» viene vacío`);
}

function leerNumero(valor: unknown, campo: string): number {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  return fallo(`el campo «${campo}» no es un número`);
}

/** Odoo escribe las fechas como `YYYY-MM-DD` y las fecha-hora como `YYYY-MM-DD HH:MM:SS`. */
export function leerFecha(valor: unknown, campo: string): string {
  const texto = leerTexto(valor, campo);
  const fecha = texto.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fallo(`el campo «${campo}» no es una fecha`);
  return fecha;
}

/** Días completos entre el vencimiento y hoy, contados en UTC. */
export function diasVencida(fechaVencimiento: string, ahora: Date): number {
  const vencimiento = Date.parse(`${fechaVencimiento}T00:00:00.000Z`);
  const hoy = Date.parse(`${ahora.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return Math.floor((hoy - vencimiento) / MILISEGUNDOS_POR_DIA);
}

/**
 * Días vencida de un registro crudo, antes de mapearlo.
 *
 * Odoo devuelve lo que pide el dominio, que trabaja con fechas y no con días:
 * en el borde del rango puede colarse una factura no vencida. Se descarta aquí,
 * antes de convertirla, porque una factura del contrato siempre está vencida.
 */
export function diasVencidaDeRegistro(registro: unknown, ahora: Date): number {
  if (!esObjeto(registro)) return fallo('el registro no es un objeto');
  return diasVencida(leerFecha(registro['invoice_date_due'], 'invoice_date_due'), ahora);
}

/** Un registro de `account.move` convertido en factura del contrato. */
export function aFactura(registro: unknown, ahora: Date): FacturaVencida {
  if (!esObjeto(registro)) return fallo('el registro no es un objeto');
  const vencimiento = leerFecha(registro['invoice_date_due'], 'invoice_date_due');
  const moneda = leerRelacion(registro['currency_id'], 'currency_id');
  return Factura.parse({
    id: leerNumero(registro['id'], 'id'),
    numero: leerTexto(registro['name'], 'name'),
    cliente: leerRelacion(registro['partner_id'], 'partner_id'),
    importe_pendiente: leerNumero(registro['amount_residual'], 'amount_residual'),
    moneda: moneda.nombre.toUpperCase(),
    fecha_emision: leerFecha(registro['invoice_date'], 'invoice_date'),
    fecha_vencimiento: vencimiento,
    dias_vencida: diasVencida(vencimiento, ahora),
  });
}

/**
 * Saca la lista de registros de la envolvente del MCP dinámico.
 *
 * Se aceptan las formas conocidas del servidor; la prueba de contrato contra la
 * instancia real es la que fija cuál llega de verdad.
 */
export function leerRegistros(carga: unknown): unknown[] {
  if (Array.isArray(carga)) return carga;
  if (esObjeto(carga)) {
    for (const clave of ['records', 'results', 'data', 'rows'] as const) {
      const valor = carga[clave];
      if (Array.isArray(valor)) return valor;
      if (esObjeto(valor)) return leerRegistros(valor);
    }
  }
  return fallo('no trae ninguna lista de registros');
}

/** Saca el identificador que devuelve una escritura del MCP dinámico. */
export function leerIdentificador(carga: unknown): number {
  if (typeof carga === 'number' && Number.isInteger(carga) && carga > 0) return carga;
  if (Array.isArray(carga) && carga.length > 0) return leerIdentificador(carga[0]);
  if (esObjeto(carga)) {
    for (const clave of ['message_id', 'activity_id', 'id', 'res_id', 'record_id'] as const) {
      const valor = carga[clave];
      if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor;
    }
    for (const clave of ['result', 'data', 'record', 'records', 'ids'] as const) {
      if (clave in carga) return leerIdentificador(carga[clave]);
    }
  }
  return fallo('la escritura no devuelve identificador');
}

/** La fecha de creación que devuelva el ERP; si no la devuelve, la del conector. */
export function leerCreadoEn(carga: unknown, ahora: Date): string {
  if (esObjeto(carga)) {
    for (const clave of ['create_date', 'creado_en', 'date', 'write_date'] as const) {
      const valor = carga[clave];
      if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(valor)) {
        const normalizada = new Date(`${valor.slice(0, 10)}T${valor.slice(11, 19)}Z`);
        if (!Number.isNaN(normalizada.getTime())) return normalizada.toISOString();
      }
    }
  }
  return ahora.toISOString();
}
