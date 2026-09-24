/**
 * @aiw/worker
 *
 * Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.
 *
 * Dos mitades con reglas distintas. `src/flujos` es determinista y se compila
 * aislado: se puede volver a ejecutar desde el historial de Temporal y da siempre
 * lo mismo. `src/actividades` es donde viven los efectos: base de datos, gateway
 * MCP, proveedores de modelo. `src/bucle` es el bucle del agente, código propio
 * sobre las primitivas del AI SDK, sin efectos y sin framework de agentes.
 *
 * Todo detrás de `AIW_PRUEBA_STACK`. Con la bandera apagada el proceso imprime qué
 * le falta y termina limpio, y para eso `main.ts` no importa este módulo: importarlo
 * cargaría el AI SDK y el cliente de MCP sin necesidad.
 */
export * from './aplicacion.js';
export * from './configuracion.js';
export * from './bucle/tipos.js';
export * from './bucle/guardias.js';
export * from './bucle/bucle.js';
export * from './actividades/contexto.js';
export * from './actividades/index.js';
export * from './semilla.js';
export * from './trabajador.js';
