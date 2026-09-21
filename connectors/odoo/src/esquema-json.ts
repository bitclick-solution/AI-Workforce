/**
 * Esquemas JSON Schema que el conector anuncia en `tools/list`.
 *
 * Se escriben a mano y a propósito: son el contrato público, el gateway los
 * enseña al modelo y deben decir exactamente lo mismo que los esquemas Zod de
 * `esquemas.ts`, que son los que validan de verdad. Una prueba comprueba que
 * los dos no se separan.
 */

export const ESQUEMA_ENTRADA_LISTAR = {
  type: 'object',
  properties: {
    dias_vencida_minimo: {
      type: 'integer',
      minimum: 0,
      default: 1,
      description: 'Días vencida como mínimo. Por defecto 1: nunca devuelve facturas no vencidas.',
    },
    limite: {
      type: 'integer',
      minimum: 1,
      maximum: 200,
      default: 50,
      description: 'Número máximo de facturas devueltas.',
    },
  },
  additionalProperties: false,
} as const;

export const ESQUEMA_ENTRADA_NOTA = {
  type: 'object',
  properties: {
    factura_id: {
      type: 'integer',
      minimum: 1,
      description: 'Identificador de la factura en el ERP.',
    },
    texto: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
      description: 'Texto plano de la nota, sin HTML.',
    },
    tipo: {
      type: 'string',
      enum: ['nota', 'actividad'],
      default: 'nota',
      description: 'Nota en el historial de la factura o actividad con fecha límite.',
    },
    fecha_limite: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Fecha límite de la actividad. Solo con tipo «actividad».',
    },
    clave_idempotencia: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description: 'Con la misma clave se devuelve la misma nota sin crear otra.',
    },
  },
  required: ['factura_id', 'texto'],
  additionalProperties: false,
} as const;
