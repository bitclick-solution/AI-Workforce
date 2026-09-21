/**
 * Identidad de la aplicación, sin arrastrar nada detrás.
 *
 * Vive en su propio módulo y no en `index.ts` por una razón concreta: `index.ts`
 * reexporta el bucle, las actividades y el trabajador, así que importarlo carga el
 * AI SDK, el cliente de MCP y el de Temporal. `main.ts` solo necesita saber cómo se
 * llama la aplicación para decir que le falta la bandera, y con la bandera apagada
 * no tiene por qué cargar nada de eso.
 *
 * El job «Imagen worker» de la integración continua arranca el contenedor sin
 * entorno y espera que salga limpio; con `index.ts` en el camino, saldría con un
 * fallo de un módulo que no hacía falta.
 */
export const APLICACION = {
  nombre: '@aiw/worker',
  tipo: 'aplicacion',
  responsabilidad:
    'Temporal: flujos de tarea, delegación entre agentes, bucle del agente y aprendizaje programado.',
  dependeDe: ['@aiw/domain', '@aiw/models', '@aiw/learning', '@aiw/mcp-gateway'],
} as const;

export type Aplicacion = typeof APLICACION;
