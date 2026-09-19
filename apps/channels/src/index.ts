import { PAQUETE as domain } from '@aiw/domain';
import { PAQUETE as notifications } from '@aiw/notifications';

/**
 * @aiw/channels
 *
 * Canales: WhatsApp, correo y enlaces de aprobación firmados de un solo uso.
 *
 * Esta rebanada solo fija la frontera de la aplicación. Sin lógica de negocio todavía.
 */
export const APLICACION = {
  nombre: '@aiw/channels',
  tipo: 'aplicacion',
  responsabilidad: 'Canales: WhatsApp, correo y enlaces de aprobación firmados de un solo uso.',
  dependeDe: [domain.nombre, notifications.nombre],
} as const;

export type Aplicacion = typeof APLICACION;
