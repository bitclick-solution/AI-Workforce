import { PAQUETE as db } from '@aiw/db';
import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as ledger } from '@aiw/ledger';
import { PAQUETE as notifications } from '@aiw/notifications';

/**
 * @aiw/channels
 *
 * Canales: WhatsApp, correo y enlaces de aprobación firmados de un solo uso.
 *
 * La primera rebanada que llena esta aplicación es «Aprobación por correo con
 * enlaces firmados y libro de auditoría v0»: firma el enlace, compone el correo,
 * sirve la página genérica de aprobación, registra la decisión por `@aiw/ledger` y
 * la entrega al flujo de la tarea como señal. WhatsApp y el resto de canales
 * reutilizarán los mismos puertos.
 */
export const APLICACION = {
  nombre: '@aiw/channels',
  tipo: 'aplicacion',
  responsabilidad: 'Canales: WhatsApp, correo y enlaces de aprobación firmados de un solo uso.',
  dependeDe: [db.nombre, domain.nombre, ledger.nombre, notifications.nombre],
} as const;

export type Aplicacion = typeof APLICACION;

// Aprobación por correo v0
export * from './secreto.js';
export * from './html.js';
export * from './reintentos.js';
export * from './correo/memoria.js';
export * from './correo/smtp.js';
export * from './senal/memoria.js';
export * from './senal/temporal.js';
export * from './aprobacion/configuracion.js';
export * from './aprobacion/firma.js';
export * from './aprobacion/plantilla.js';
export * from './aprobacion/paginas.js';
export * from './aprobacion/servicio.js';
export * from './aprobacion/servidor.js';
export * from './aprobacion/montaje.js';
