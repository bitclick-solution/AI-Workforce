/**
 * @aiw/models
 *
 * Enrutado de modelos sobre el AI SDK, caché de prompts y coste por tarea.
 * Sin credenciales de proveedores en el código; llegan por configuración.
 *
 * Lo que este paquete hace y lo que no:
 *
 * - Hace un paso de modelo con las primitivas del AI SDK, con las herramientas
 *   ofrecidas sin función que las ejecute, para que el bucle se quede en casa.
 * - Traduce el uso del proveedor a los tokens que cobra el contador. El precio lo
 *   pone `@aiw/ledger` con la tarifa vigente del tenant, no este paquete.
 * - Compone y cachea el prompt de la versión de puesto y pide la caché del
 *   proveedor.
 * - Declara qué lleva cada traza: tenant, puesto, tarea y versión, siempre.
 */
export const PAQUETE = {
  nombre: '@aiw/models',
  tipo: 'paquete',
  responsabilidad: 'Enrutado de modelos sobre el AI SDK, caché de prompts y coste por tarea.',
} as const;

export type Paquete = typeof PAQUETE;

// Prueba técnica del stack
export * from './proveedor-prueba.js';
export * from './enrutado.js';
export * from './uso.js';
export * from './trazas.js';
export * from './paso.js';
export * from './conversacion.js';
export * from './cache-de-prompts.js';
export * from './guiones/index.js';
