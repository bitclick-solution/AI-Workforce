/**
 * Enrutado de modelos: del `enrutado_modelo` del puesto a un modelo del AI SDK.
 *
 * El enrutado es dato de la organización, no código desplegado: vive en la columna
 * `puesto.enrutado_modelo` y dice proveedor, modelo y alternativas. Cambiar el
 * modelo de un puesto es editar una fila, y esta función es lo único que hay entre
 * esa fila y la llamada.
 *
 * Los proveedores se registran en el proceso, igual que los servidores MCP en el
 * gateway. Ninguno viene registrado: el proceso registra el que eligió por
 * configuración (`enrutador-entorno.ts`) y el de prueba solo entra si se elige por
 * escrito. Aquí no hay ninguna credencial ni ninguna variable de entorno leída.
 *
 * Un puesto enruta de dos formas. Por **proveedor y modelo** (`{ proveedor, modelo }`,
 * la forma de las demostraciones) o por **papel** (`{ papel }`, la de las plantillas
 * certificadas, ADR-018): el papel no sabe con qué plataforma se sirve, y el
 * identificador concreto lo resuelve `identificadores.ts` según el proveedor elegido.
 */
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { esquemas, type PapelModelo, type PlataformaModelo } from '@aiw/domain';
import { z } from 'zod';

import { crearPuertoEnrutado, type ProveedorDePuertos, type PuertoEnrutado } from './respaldo.js';
import { modeloDeTarifa } from './identificadores.js';
import type { PuertoDeModelo } from './puerto.js';
import { PROVEEDOR_PRUEBA, crearProveedorDePrueba, type Guion } from './proveedor-prueba.js';

/**
 * Lo que dice `puesto.enrutado_modelo`. Sin valores por defecto: un enrutado vacío
 * no significa «prueba», significa que a ese puesto nadie le dijo con qué modelo
 * decidir, y eso se dice en voz alta en vez de cobrar (o no cobrar) por otro modelo.
 */
export const enrutadoModelo = z
  .object({
    /** Enrutado explícito: proveedor y modelo. Van juntos. */
    proveedor: z.string().min(1).optional(),
    modelo: z.string().min(1).optional(),
    /** Enrutado por papel (ADR-018): el proveedor lo elige la configuración del proceso. */
    papel: esquemas.papelModelo.optional(),
    /** Papel que prueba el puesto tras un rechazo del clasificador. */
    papelRespaldo: esquemas.papelModelo.optional(),
    /**
     * Modelo del proveedor de prueba que contesta a este puesto cuando el proceso
     * eligió `prueba` a propósito (CI, evals de humo, demo local).
     */
    modeloDePrueba: z.string().min(1).optional(),
    /** Región exigida, cuando el tenant la exige. Informativa para el enrutador. */
    region: z.string().min(1).optional(),
    /** Alternativas por si el principal no está disponible, en orden de preferencia. */
    alternativas: z
      .array(z.object({ proveedor: z.string().min(1), modelo: z.string().min(1) }))
      .default([]),
  })
  .refine((e) => (e.proveedor !== undefined && e.modelo !== undefined) || e.papel !== undefined, {
    message:
      'el enrutado necesita un papel (opus5, sonnet5 o haiku45) o un proveedor con su modelo; ' +
      'no se cae a ningún modelo por defecto',
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

/** Crea el puerto de un papel en un proveedor real. Se llama en cada paso: tiene que ser barata. */
export type FabricaDePuerto = (papel: PapelModelo) => PuertoDeModelo;

/** Proveedor con el que el catálogo de tarifas (`tarifa_modelo`) da de alta los modelos de Anthropic. */
export const PROVEEDOR_DE_TARIFA = 'anthropic';

/** Una fila de `tarifa_modelo` que tiene que existir para poder cobrar un paso. */
export interface TarifaEsperada {
  proveedor: string;
  modelo: string;
  plataforma: PlataformaModelo;
}

/** Qué proveedores usa el proceso: el principal y, opcionalmente, el de respaldo. */
export interface EleccionDeProveedores {
  principal: string;
  respaldo?: string | undefined;
}

/** Lo que resuelve el enrutador para un paso de modelo. */
export type PasoResuelto =
  | {
      via: 'modelo';
      modelo: LanguageModelV4;
      proveedor: string;
      modeloId: string;
    }
  | {
      via: 'puerto';
      puerto: PuertoEnrutado;
      proveedor: string;
      papel: PapelModelo;
      /**
       * Tarifas que hacen falta en el proveedor principal para cobrar el paso, el papel
       * y el de respaldo. Se comprueban antes de llamar: una llamada que no se puede
       * cobrar no se hace, porque reintentarla la pagaría otra vez.
       */
      tarifasEsperadas: TarifaEsperada[];
    };

export class Enrutador {
  readonly #fabricas = new Map<string, FabricaDeModelo>();
  readonly #puertos = new Map<string, { fabrica: FabricaDePuerto; plataforma: PlataformaModelo }>();
  #eleccion: EleccionDeProveedores | undefined;

  registrar(proveedor: string, fabrica: FabricaDeModelo): this {
    this.#fabricas.set(proveedor, fabrica);
    return this;
  }

  /** Registra un proveedor real, servido por el puerto de Modelos v1 (Bedrock UE, Vertex UE). */
  registrarPuerto(proveedor: string, plataforma: PlataformaModelo, fabrica: FabricaDePuerto): this {
    this.#puertos.set(proveedor, { fabrica, plataforma });
    return this;
  }

  /** Dice qué proveedores usan los puestos que enrutan por papel. */
  elegir(eleccion: EleccionDeProveedores): this {
    this.#eleccion = eleccion;
    return this;
  }

  get eleccion(): EleccionDeProveedores | undefined {
    return this.#eleccion;
  }

  get proveedores(): readonly string[] {
    return [...this.#fabricas.keys(), ...this.#puertos.keys()];
  }

  /**
   * Resuelve el paso de modelo de un puesto.
   *
   * Con `{ proveedor, modelo }` usa ese proveedor, o la primera alternativa
   * registrada. Con `{ papel }` usa el proveedor que eligió el proceso. En los dos
   * casos, un proveedor que no está registrado falla con la lista de lo que sí hay:
   * un enrutado que se cae en silencio a otro modelo cobra distinto sin avisar.
   */
  resolverPaso(enrutado: unknown): PasoResuelto {
    const analizado = enrutadoModelo.safeParse(enrutado ?? {});
    if (!analizado.success) {
      throw new Error(
        `El enrutado del puesto no es válido: ${analizado.error.issues.map((i) => i.message).join('; ')}.`,
      );
    }
    const configuracion = analizado.data;

    if (configuracion.proveedor !== undefined && configuracion.modelo !== undefined) {
      return this.#resolverExplicito(configuracion.proveedor, configuracion.modelo, configuracion);
    }
    return this.#resolverPorPapel(configuracion.papel as PapelModelo, configuracion);
  }

  /** Resuelve un enrutado que pasa por el AI SDK (el proveedor de prueba). Falla si el puesto va a un proveedor real. */
  resolver(enrutado: unknown): { modelo: LanguageModelV4; proveedor: string; modeloId: string } {
    const paso = this.resolverPaso(enrutado);
    if (paso.via !== 'modelo') {
      throw new Error(
        `El puesto enruta a ${paso.proveedor}, que se sirve por el puerto de modelo: usa resolverPaso.`,
      );
    }
    return { modelo: paso.modelo, proveedor: paso.proveedor, modeloId: paso.modeloId };
  }

  #resolverExplicito(
    proveedor: string,
    modelo: string,
    configuracion: z.infer<typeof enrutadoModelo>,
  ): PasoResuelto {
    const candidatos = [{ proveedor, modelo }, ...configuracion.alternativas];
    for (const candidato of candidatos) {
      const fabrica = this.#fabricas.get(candidato.proveedor);
      if (fabrica) {
        return {
          via: 'modelo',
          modelo: fabrica(candidato.modelo),
          proveedor: candidato.proveedor,
          modeloId: candidato.modelo,
        };
      }
    }
    throw new ProveedorNoRegistrado(proveedor, this.proveedores);
  }

  #resolverPorPapel(
    papel: PapelModelo,
    configuracion: z.infer<typeof enrutadoModelo>,
  ): PasoResuelto {
    const eleccion = this.#eleccion;
    if (!eleccion) {
      throw new Error(
        `El puesto enruta por papel (${papel}) pero este proceso no eligió proveedor de modelos: ` +
          'configura AIW_PROVEEDOR_MODELOS.',
      );
    }

    const deModelo = this.#fabricas.get(eleccion.principal);
    if (deModelo) {
      if (configuracion.modeloDePrueba === undefined) {
        throw new Error(
          `El puesto enruta por papel (${papel}) y el proceso eligió «${eleccion.principal}»: ` +
            'el enrutado del puesto necesita modeloDePrueba para saber qué guion lo contesta.',
        );
      }
      return {
        via: 'modelo',
        modelo: deModelo(configuracion.modeloDePrueba),
        proveedor: eleccion.principal,
        modeloId: configuracion.modeloDePrueba,
      };
    }

    const principal = this.#puertos.get(eleccion.principal);
    if (!principal) throw new ProveedorNoRegistrado(eleccion.principal, this.proveedores);

    const nombreRespaldo =
      eleccion.respaldo !== undefined && eleccion.respaldo !== eleccion.principal
        ? eleccion.respaldo
        : undefined;
    const respaldo = nombreRespaldo === undefined ? undefined : this.#puertos.get(nombreRespaldo);
    const comoProveedor = (
      proveedor: string,
      registrado: { fabrica: FabricaDePuerto },
    ): ProveedorDePuertos => ({ proveedor, puerto: registrado.fabrica });
    const papelesEsperados = [papel, configuracion.papelRespaldo].filter(
      (esperado, indice, todos): esperado is PapelModelo =>
        esperado !== undefined && todos.indexOf(esperado) === indice,
    );

    return {
      via: 'puerto',
      proveedor: eleccion.principal,
      papel,
      tarifasEsperadas: papelesEsperados.map((esperado) => ({
        proveedor: PROVEEDOR_DE_TARIFA,
        modelo: modeloDeTarifa(esperado, principal.plataforma),
        plataforma: principal.plataforma,
      })),
      puerto: crearPuertoEnrutado({
        papel,
        papelRespaldo: configuracion.papelRespaldo,
        principal: comoProveedor(eleccion.principal, principal),
        ...(nombreRespaldo !== undefined && respaldo !== undefined
          ? { respaldo: comoProveedor(nombreRespaldo, respaldo) }
          : {}),
      }),
    };
  }
}

/**
 * Enrutador con el proveedor de prueba registrado y elegido.
 *
 * Es lo que usan las pruebas y las demostraciones sin claves, y lo eligen a
 * propósito: llamar a esta función es escribir «prueba». Un proceso con claves usa
 * `enrutadorDesdeEntorno`.
 */
export function enrutadorDePrueba(guion: Guion): Enrutador {
  return new Enrutador()
    .registrar(PROVEEDOR_PRUEBA, (modeloId) => crearProveedorDePrueba({ guion, modeloId }))
    .elegir({ principal: PROVEEDOR_PRUEBA });
}
