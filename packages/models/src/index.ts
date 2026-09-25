/**
 * @aiw/models
 *
 * Dos rutas, dos rebanadas:
 *
 * - **Modelos v1** (ADR-002, ADR-017, ADR-018): Anthropic por el SDK oficial sobre
 *   Bedrock UE y Vertex UE detrás de un puerto (`puerto.ts`), y el AI SDK como
 *   pasarela para Mistral, modelos locales y el proveedor determinista de la
 *   integración continua. Esfuerzo por clase de paso, salidas estructuradas
 *   estrictas, tratamiento del rechazo del clasificador con respaldo decidido por
 *   la política del puesto, y coste por tarea completada a Langfuse.
 * - **Prueba técnica del stack**: un paso de modelo con las primitivas del AI SDK
 *   (`paso.ts`), caché de prompts (`cache-de-prompts.ts`), trazas (`trazas.ts`),
 *   traducción del uso del proveedor a los tokens que cobra el contador
 *   (`uso.ts`) y el enrutador con guiones deterministas para Cobros y
 *   Conciliación (`enrutado.ts`, `guiones/`) que usa el bucle del agente en la
 *   integración continua. Sin credenciales de proveedores en el código; llegan
 *   por configuración.
 */
export const PAQUETE = {
  nombre: '@aiw/models',
  tipo: 'paquete',
  responsabilidad: 'Enrutado de modelos sobre el AI SDK, caché de prompts y coste por tarea.',
} as const;

export type Paquete = typeof PAQUETE;

export { identificadorDeModelo, nombreCanonico } from './identificadores.js';
export { esfuerzoParaClase } from './esfuerzo.js';
export type {
  CategoriaRechazo,
  HerramientaDeModelo,
  MensajeDeModelo,
  MensajeRol,
  PeticionDeModelo,
  PuertoDeModelo,
  RespuestaDeModelo,
  RespuestaDeModeloOk,
  RespuestaDeModeloRechazo,
  TokensDeUso,
} from './puerto.js';
export { completarConRespaldo, decidirRespaldo, type ResultadoConRespaldo } from './respaldo.js';

export {
  MAX_TOKENS_POR_DEFECTO,
  crearAdaptadorAnthropic,
  type OpcionesAdaptadorAnthropic,
} from './adaptadores/anthropic.js';
export type { ClienteDeMensajes } from './adaptadores/cliente-mensajes.js';
export {
  clienteBedrockDesdeEntorno,
  clientePrimeraParteDesdeEntorno,
  clienteSimulado,
  clienteVertexDesdeEntorno,
  type Entorno as EntornoClientes,
} from './adaptadores/clientes.js';
export { crearAdaptadorAiSdk, type OpcionesAdaptadorAiSdk } from './adaptadores/ai-sdk.js';

export {
  crearObservadorLangfuse,
  observadorDesdeEntorno,
  observadorEnMemoria,
  observadorNulo,
  type EventoCosteDeTarea,
  type Entorno as EntornoLangfuse,
  type OpcionesLangfuse,
  type PuertoDeObservabilidadDeCoste,
} from './observabilidad/langfuse.js';

// Prueba técnica del stack
export * from './proveedor-prueba.js';
export * from './enrutado.js';
export * from './uso.js';
export * from './trazas.js';
export * from './paso.js';
export * from './conversacion.js';
export * from './cache-de-prompts.js';
export * from './guiones/index.js';
