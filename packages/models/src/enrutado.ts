/**
 * Enrutado de modelos: del `enrutado_modelo` del puesto a un modelo del AI SDK.
 *
 * El enrutado es dato de la organización, no código desplegado: vive en la columna
 * `puesto.enrutado_modelo` y dice proveedor, modelo y alternativas. Cambiar el
 * modelo de un puesto es editar una fila, y esta función es lo único que hay entre
 * esa fila y la llamada.
 *
 * Los proveedores se registran en el proceso, igual que los servidores MCP en el
 * gateway. El de prueba viene registrado; los de verdad los registra el proceso que
 * tenga sus claves, que nunca es este paquete: aquí no hay ninguna credencial ni
 * ninguna variable de entorno leída.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { z } from 'zod';

import {
  MODELO_PRUEBA,
  PROVEEDOR_PRUEBA,
  crearProveedorDePrueba,
  type Guion,
} from './proveedor-prueba.js';

/** Lo que dice `puesto.enrutado_modelo`. Todo opcional: hay valores por defecto. */
export const enrutadoModelo = z.object({
  proveedor: z.string().min(1).default(PROVEEDOR_PRUEBA),
  modelo: z.string().min(1).default(MODELO_PRUEBA),
  /** Región exigida, cuando el tenant la exige. Informativa para el enrutador. */
  region: z.string().min(1).optional(),
  /** Alternativas por si el principal no está disponible, en orden de preferencia. */
  alternativas: z
    .array(z.object({ proveedor: z.string().min(1), modelo: z.string().min(1) }))
    .default([]),
});

export type EnrutadoModelo = z.infer<typeof enrutadoModelo>;

/** Crea el modelo del AI SDK de un proveedor y un identificador de modelo. */
export type FabricaDeModelo = (modeloId: string) => LanguageModelV4;

export class ProveedorNoRegistrado extends Error {
  constructor(proveedor: string, registrados: readonly string[]) {
    super(
      `El proveedor «${proveedor}» no está registrado en este proceso. ` +
        `Registrados: ${registrados.length === 0 ? 'ninguno' : registrados.join(', ')}. ` +
        'Las claves de los proveedores llegan por configuración, nunca desde el código.',
    );
    this.name = 'ProveedorNoRegistrado';
  }
}

export class Enrutador {
  readonly #fabricas = new Map<string, FabricaDeModelo>();

  registrar(proveedor: string, fabrica: FabricaDeModelo): this {
    this.#fabricas.set(proveedor, fabrica);
    return this;
  }

  get proveedores(): readonly string[] {
    return [...this.#fabricas.keys()];
  }

  /**
   * Resuelve el modelo del puesto. Si el principal no está registrado, prueba las
   * alternativas en orden y falla con la lista de lo que sí hay: un enrutado que se
   * cae en silencio a otro modelo cobra distinto sin avisar.
   */
  resolver(enrutado: unknown): { modelo: LanguageModelV4; proveedor: string; modeloId: string } {
    const configuracion = enrutadoModelo.parse(enrutado ?? {});
    const candidatos = [
      { proveedor: configuracion.proveedor, modelo: configuracion.modelo },
      ...configuracion.alternativas,
    ];

    for (const candidato of candidatos) {
      const fabrica = this.#fabricas.get(candidato.proveedor);
      if (fabrica) {
        return {
          modelo: fabrica(candidato.modelo),
          proveedor: candidato.proveedor,
          modeloId: candidato.modelo,
        };
      }
    }
    throw new ProveedorNoRegistrado(configuracion.proveedor, this.proveedores);
  }
}

/**
 * Enrutador con el proveedor de prueba registrado.
 *
 * Es lo que usan la integración continua y la demostración sin claves. Un proceso
 * con claves registra encima los proveedores de verdad y el enrutado del puesto
 * decide cuál se usa, sin tocar este paquete.
 */
export function enrutadorDePrueba(guion: Guion): Enrutador {
  return new Enrutador().registrar(PROVEEDOR_PRUEBA, (modeloId) =>
    crearProveedorDePrueba({ guion, modeloId }),
  );
}
