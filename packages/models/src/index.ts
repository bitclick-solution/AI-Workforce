/**
 * @aiw/models
 *
 * Enrutado de modelos sobre el AI SDK, caché de prompts y coste por tarea.
 * Sin credenciales de proveedores en el código; llegan por configuración.
 *
 * Esta rebanada solo fija la frontera del paquete. Sin lógica de negocio todavía.
 */
export const PAQUETE = {
  nombre: '@aiw/models',
  tipo: 'paquete',
  responsabilidad: 'Enrutado de modelos sobre el AI SDK, caché de prompts y coste por tarea.',
} as const;

export type Paquete = typeof PAQUETE;
