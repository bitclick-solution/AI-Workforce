/**
 * Conformidad con los esquemas vivos del MCP dinámico.
 *
 * Las grabaciones inventadas ocultaron tres derivas (`records` frente a
 * `result`, la aprobación bajo `result`, `res_id` frente a `record_id`). Este
 * cliente envuelve a otro y valida los argumentos de cada llamada contra el
 * esquema de entrada real de la herramienta, tal como lo anuncia el `tools/list`
 * de la imagen que corre en la máquina de Jesús. Una herramienta sin esquema
 * conocido, o unos argumentos que no encajan, fallan en la prueba.
 */
import { z } from 'zod';

import type { ClienteMcpDinamico } from './cliente.js';

/** `inputSchema` (JSON Schema) de cada herramienta del MCP dinámico, por nombre. */
export type EsquemasVivos = Readonly<Record<string, unknown>>;

export class ErrorDeConformidad extends Error {
  constructor(
    readonly herramienta: string,
    detalle: string,
  ) {
    super(`La llamada a «${herramienta}» no cumple el esquema vivo del MCP dinámico: ${detalle}`);
    this.name = 'ErrorDeConformidad';
  }
}

export function clienteConformante(
  cliente: ClienteMcpDinamico,
  esquemas: EsquemasVivos,
): ClienteMcpDinamico {
  const validadores = new Map<string, z.ZodType>();
  return {
    async llamar(herramienta, argumentos) {
      const esquema = esquemas[herramienta];
      if (esquema === undefined) {
        throw new ErrorDeConformidad(herramienta, 'no hay esquema vivo para esta herramienta.');
      }
      let validador = validadores.get(herramienta);
      if (validador === undefined) {
        validador = z.fromJSONSchema(esquema as Parameters<typeof z.fromJSONSchema>[0]);
        validadores.set(herramienta, validador);
      }
      const resultado = validador.safeParse(argumentos);
      if (!resultado.success) {
        const detalle = resultado.error.issues
          .map((problema) => `${problema.path.join('.') || '(raíz)'}: ${problema.message}`)
          .join('; ')
          .slice(0, 400);
        throw new ErrorDeConformidad(herramienta, detalle);
      }
      return cliente.llamar(herramienta, argumentos);
    },
    cerrar: () => cliente.cerrar(),
  };
}
