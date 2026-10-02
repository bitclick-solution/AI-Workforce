/**
 * Mapeo entre `account.bank.statement.line` y el apunte del contrato.
 *
 * Reutiliza las lecturas de relación, fecha y envolvente de `mapeo.ts`: el MCP
 * dinámico devuelve estos registros con la misma forma que las facturas.
 */
import { ErrorConector } from './errores.js';
import { Apunte, type ApunteBancario } from './esquemas-conciliacion.js';
import { leerFecha, leerRelacion } from './mapeo.js';

/** Campos de `account.bank.statement.line` que pide el conector. Ni uno más. */
export const CAMPOS_APUNTE = [
  'journal_id',
  'date',
  'payment_ref',
  'amount',
  'currency_id',
  'is_reconciled',
  'move_id',
] as const;

function fallo(mensaje: string): never {
  throw new ErrorConector('invalido', `La respuesta del ERP no encaja en el contrato: ${mensaje}`);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function redondear(importe: number): number {
  return Math.round(importe * 100) / 100;
}

/** Un registro de `account.bank.statement.line` convertido en apunte del contrato. */
export function aApunte(registro: unknown): ApunteBancario {
  if (!esObjeto(registro)) return fallo('el registro no es un objeto');
  const id = registro['id'];
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    return fallo('el campo «id» no es un identificador');
  }
  const importe = registro['amount'];
  if (typeof importe !== 'number' || !Number.isFinite(importe)) {
    return fallo('el campo «amount» no es un número');
  }
  const casado = registro['is_reconciled'] === true;
  // Odoo pone `false` en un campo de texto vacío.
  const concepto = registro['payment_ref'];
  return Apunte.parse({
    id: String(id),
    cuenta_id: String(leerRelacion(registro['journal_id'], 'journal_id').id),
    fecha: leerFecha(registro['date'], 'date'),
    concepto: typeof concepto === 'string' ? concepto : '',
    importe: redondear(importe),
    moneda: leerRelacion(registro['currency_id'], 'currency_id').nombre.toUpperCase(),
    casado,
    // El asiento propio del apunte: Odoo no cuelga el documento casado del
    // apunte, así que para uno casado se devuelve el asiento que lo contabiliza.
    documento_id: casado ? idDeRelacionOpcional(registro['move_id']) : null,
  });
}

function idDeRelacionOpcional(valor: unknown): string | null {
  if (valor === false || valor === null || valor === undefined) return null;
  return String(leerRelacion(valor, 'move_id').id);
}

/** Orden del contrato: del más antiguo al más reciente; a igual fecha, por identificador. */
export function compararApuntes(una: ApunteBancario, otra: ApunteBancario): number {
  if (una.fecha !== otra.fecha) return una.fecha < otra.fecha ? -1 : 1;
  return Number(una.id) - Number(otra.id);
}
