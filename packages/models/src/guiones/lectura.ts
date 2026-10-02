/**
 * Lectura de la conversación para los guiones del proveedor de prueba.
 *
 * Los guiones deciden solo con lo que ya hay en la conversación: qué pidió la
 * persona y qué devolvieron las herramientas. Estas funciones son esa lectura, y
 * viven aparte para que los dos guiones lean igual y no se desvíen uno del otro.
 */
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

import type { FacturaParaNota } from './cobros.js';

/**
 * Texto del encargo: el primer mensaje de la persona.
 *
 * En una tarea es lo que se pidió; en una delegación, el encargo del contrato. Es
 * lo único que dice sobre qué hay que trabajar.
 */
export function encargoDe(prompt: LanguageModelV4Prompt): string {
  for (const mensaje of prompt) {
    if (mensaje.role !== 'user') continue;
    return mensaje.content.map((parte) => (parte.type === 'text' ? parte.text : '')).join('\n');
  }
  return '';
}

/** Resultados de herramienta que ya hay en la conversación, por nombre. */
export function resultadosDe(prompt: LanguageModelV4Prompt, herramienta: string): string[] {
  const textos: string[] = [];
  for (const mensaje of prompt) {
    if (mensaje.role !== 'tool') continue;
    for (const parte of mensaje.content) {
      if (parte.type !== 'tool-result' || parte.toolName !== herramienta) continue;
      const salida = parte.output;
      if (salida.type === 'text' || salida.type === 'error-text') textos.push(salida.value);
      else if (salida.type === 'json' || salida.type === 'error-json') {
        textos.push(JSON.stringify(salida.value));
      }
      // Una ejecución denegada no es un resultado: no hay nada que leer en ella.
    }
  }
  return textos;
}

/**
 * Lee la cartera del resultado de la herramienta.
 *
 * Un resultado que no es la carga del contrato no es una cartera de facturas, y
 * entonces no hay nada sobre lo que escribir: el agente no inventa notas sobre algo
 * que no ha entendido. Eso incluye los errores del contrato, que también son JSON.
 */
export function facturasDelResultado(texto: string): FacturaParaNota[] {
  try {
    const analizado: unknown = JSON.parse(texto);
    const facturas = (analizado as { facturas?: unknown }).facturas;
    if (!Array.isArray(facturas)) return [];
    return facturas
      .filter(
        (factura): factura is Record<string, unknown> =>
          typeof factura === 'object' && factura !== null,
      )
      .map((factura) => {
        const cliente = factura['cliente'] as { id?: unknown; nombre?: unknown } | undefined;
        return {
          id: String(factura['id']),
          numero: String(factura['numero']),
          cliente: { id: String(cliente?.id ?? ''), nombre: String(cliente?.nombre ?? '') },
          importe_pendiente: Number(factura['importe_pendiente']),
          moneda: String(factura['moneda'] ?? 'EUR'),
          dias_vencida: Number(factura['dias_vencida']),
        };
      });
  } catch {
    return [];
  }
}

/** Apunte del extracto bancario tal como lo devuelve `leer_extracto_bancario`. */
export interface ApunteDeExtracto {
  id: string;
  cuenta_id: string;
  fecha: string;
  concepto: string;
  importe: number;
  moneda: string;
  casado: boolean;
  documento_id: string | null;
}

/**
 * Lee los apuntes del resultado de `leer_extracto_bancario`.
 *
 * Igual que con las facturas: lo que no es la carga del contrato, errores incluidos,
 * no es un extracto, y el agente no concilia contra algo que no ha entendido. Un
 * apunte con la forma rota se descarta en vez de completarse con valores
 * inventados.
 */
export function apuntesDelResultado(texto: string): ApunteDeExtracto[] {
  try {
    const analizado: unknown = JSON.parse(texto);
    const apuntes = (analizado as { apuntes?: unknown }).apuntes;
    if (!Array.isArray(apuntes)) return [];
    const validos: ApunteDeExtracto[] = [];
    for (const apunte of apuntes as unknown[]) {
      if (typeof apunte !== 'object' || apunte === null) continue;
      const campos = apunte as Record<string, unknown>;
      const documento = campos['documento_id'];
      if (
        typeof campos['id'] !== 'string' ||
        typeof campos['cuenta_id'] !== 'string' ||
        typeof campos['fecha'] !== 'string' ||
        typeof campos['concepto'] !== 'string' ||
        typeof campos['importe'] !== 'number' ||
        typeof campos['moneda'] !== 'string' ||
        typeof campos['casado'] !== 'boolean' ||
        !(documento === null || typeof documento === 'string')
      ) {
        continue;
      }
      validos.push({
        id: campos['id'],
        cuenta_id: campos['cuenta_id'],
        fecha: campos['fecha'],
        concepto: campos['concepto'],
        importe: campos['importe'],
        moneda: campos['moneda'],
        casado: campos['casado'],
        documento_id: documento,
      });
    }
    return validos;
  } catch {
    return [];
  }
}
