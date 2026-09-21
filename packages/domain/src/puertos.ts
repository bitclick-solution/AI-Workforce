/**
 * Puertos: lo que la plataforma necesita del mundo, escrito como contrato.
 *
 * Aquí solo hay tipos y esquemas. Las implementaciones viven en las aplicaciones
 * —`apps/channels` trae correo en memoria y correo SMTP, señal en memoria y señal
 * contra Temporal—, así que ninguna prueba necesita un servidor real y ningún
 * paquete depende de una aplicación.
 *
 * El contrato de la señal vive en este paquete y no en `apps/channels` porque el
 * bucle del agente lo va a necesitar sin importar la aplicación de canales: el que
 * espera la decisión es el flujo de la tarea, no el canal por el que llegó.
 */
import { z } from 'zod';

import { SENTIDOS_DECISION } from './enumeraciones.js';

/** Por dónde llegó la decisión. El canal no cambia lo que se decide, pero se audita. */
export const ORIGENES_DECISION = ['correo', 'panel', 'whatsapp', 'plataforma'] as const;

export type OrigenDecision = (typeof ORIGENES_DECISION)[number];

/**
 * Un correo ya compuesto. El puerto no compone ni traduce: recibe lo que hay que
 * enviar. El cuerpo va en las dos formas porque un cliente de correo puede no
 * pintar HTML y el resumen legible tiene que leerse igual.
 */
export interface CorreoSaliente {
  de: string;
  para: string;
  asunto: string;
  texto: string;
  html: string;
}

export interface ResultadoEnvio {
  /** Identificador que da el proveedor. Sirve para cruzar con sus registros. */
  id: string;
  /** Qué implementación lo envió: `memoria` o `smtp`. Se anota en la auditoría. */
  proveedor: string;
}

export interface PuertoDeCorreo {
  enviar(correo: CorreoSaliente): Promise<ResultadoEnvio>;
}

/** A qué flujo se manda la señal y con qué nombre la espera. */
export interface DestinoDeFlujo {
  flujoId: string;
  nombreSenal: string;
}

/**
 * Lo que el flujo recibe cuando una aprobación se resuelve.
 *
 * Solo identificadores y el sentido: el borrador es una carga opaca (ADR-001) y no
 * viaja en la señal. Quien ejecuta la acción ya sabe qué pidió; lo que no sabía es
 * si podía hacerlo.
 */
export const cargaSenalDecision = z.object({
  tenantId: z.string().min(1),
  aprobacionId: z.string().min(1),
  tareaId: z.string().min(1),
  decisionId: z.string().min(1),
  sentido: z.enum(SENTIDOS_DECISION),
  origen: z.enum(ORIGENES_DECISION),
  /** Nulo cuando resuelve la plataforma por vencimiento o por política (ADR-005). */
  personaId: z.string().min(1).nullable(),
  motivo: z.string().min(1).optional(),
  decididaEn: z.string().min(1),
});

export type CargaSenalDecision = z.infer<typeof cargaSenalDecision>;

export interface PuertoDeSenal {
  entregar(destino: DestinoDeFlujo, carga: CargaSenalDecision): Promise<void>;
}
