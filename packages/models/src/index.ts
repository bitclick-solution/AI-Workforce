/**
 * @aiw/models
 *
 * Enrutado de modelos: Anthropic por el SDK oficial sobre Bedrock UE y Vertex UE
 * detrás de este puerto, y el AI SDK como pasarela para Mistral, modelos locales y
 * el proveedor determinista de la integración continua (ADR-002, ADR-017). Esfuerzo
 * por clase de paso, salidas estructuradas estrictas, tratamiento del rechazo del
 * clasificador con respaldo decidido por la política del puesto, y coste por tarea
 * completada a Langfuse (ADR-018).
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
