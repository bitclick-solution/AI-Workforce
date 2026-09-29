/**
 * Adaptador de Anthropic detrás del puerto: mismo código para Bedrock UE, Vertex UE
 * y primera parte (ADR-017), porque los tres clientes exponen la misma superficie
 * `messages.create`. Lo que cambia por plataforma vive en `clientes.ts` y en
 * `identificadores.ts`, no aquí.
 *
 * Excepción documentada (runbook de funciones ausentes): Haiku 4.5 no admite
 * pensamiento adaptativo ni `output_config.effort` — la API los rechaza en ese
 * modelo. Para el papel `haiku45` no se envía ninguno de los dos; el resto de
 * papeles sí lleva pensamiento adaptativo, como pide el ADR-018.
 *
 * Segunda excepción (decisión de Jesús, 2026-09-25, revisada el mismo día): sin
 * cuota de ningún Opus en Bedrock, `opus5` y `sonnet5` se sirven los dos con
 * Sonnet 4.6 (`identificadores.ts`). Sonnet 4.6 no admite el esfuerzo `xhigh`
 * —llegó con Opus 4.7—, así que una petición de esfuerzo `xhigh` contra un papel
 * provisional baja a `high`. Además, `opus5` lleva `high` como suelo: hace el
 * trabajo de razonamiento y de decisión de escritura con un modelo que no es un
 * Opus, así que no baja de `high` aunque la clase de paso pida menos.
 *
 * Tercera excepción (encontrada el 28-9 al ejecutar la prueba de integración de
 * Bedrock UE en `main`, PR #32): ni las herramientas `strict` ni
 * `output_config.format` admiten restricciones numéricas (`minimum`, `maximum`,
 * `multipleOf`), de longitud de cadena (`minLength`, `maxLength`) ni de tamaño de
 * array (`minItems`, `maxItems`) en el JSON Schema — la API responde 400 si
 * aparecen en cualquier nivel del esquema, y `z.number().int()` las añade aunque
 * la definición Zod no las pida explícitamente. `transformJSONSchema`, del propio
 * SDK de Anthropic (`@anthropic-ai/sdk/lib/transform-json-schema`, la misma
 * función que usan sus ayudantes `zodOutputFormat` y `betaJSONSchemaOutputFormat`),
 * las quita del esquema que viaja en la petición —a cualquier profundidad, también
 * dentro de `anyOf`, `items` y `$defs`— y las deja como una nota en `description`;
 * como la API deja de hacerlas cumplir, el adaptador las vuelve a comprobar él
 * mismo contra el esquema Zod original al recibir la respuesta: la salida
 * estructurada (ya lo hacía) y ahora también la entrada de cada llamada a
 * herramienta (`llamadasHerramientaDe`). Detalle y cómo probarlo:
 * `docs/runbooks/modelos-funciones-ausentes.md`.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import {
  type NivelEsfuerzo,
  type PapelModelo,
  type PlataformaModelo,
  type esquemas,
} from '@aiw/domain';
import { z } from 'zod';

import { esfuerzoParaClase } from '../esfuerzo.js';
import { esProvisional, identificadorDeModelo } from '../identificadores.js';
import type {
  HerramientaDeModelo,
  LlamadaHerramienta,
  PeticionDeModelo,
  PuertoDeModelo,
  RespuestaDeModelo,
  TokensDeUso,
} from '../puerto.js';
import type { ClienteDeMensajes } from './cliente-mensajes.js';

/** Máximo de tokens de salida por defecto. Ninguna clase de paso de esta rebanada necesita más. */
export const MAX_TOKENS_POR_DEFECTO = 16_000;

/** Papeles que no admiten pensamiento adaptativo ni `output_config.effort` (Haiku 4.5). */
const SIN_PENSAMIENTO_ADAPTATIVO: ReadonlySet<PapelModelo> = new Set(['haiku45']);

/** Papel con suelo de esfuerzo alto mientras lo sirve un sustituto provisional (decisión de Jesús, 2026-09-25). */
const CON_SUELO_DE_ESFUERZO_ALTO: ReadonlySet<PapelModelo> = new Set(['opus5']);

const ORDEN_ESFUERZO: readonly NivelEsfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Ajusta el esfuerzo cuando el papel lo sirve hoy un sustituto provisional:
 * `xhigh` (Opus 4.7+) no lo admite Sonnet 4.6, y `opus5` no baja de `high` (su
 * sustituto no es un Opus).
 */
function esfuerzoSoportado(
  esfuerzo: NivelEsfuerzo,
  papel: PapelModelo,
  provisional: boolean,
): NivelEsfuerzo {
  if (!provisional) return esfuerzo;
  const conSuelo =
    CON_SUELO_DE_ESFUERZO_ALTO.has(papel) &&
    ORDEN_ESFUERZO.indexOf(esfuerzo) < ORDEN_ESFUERZO.indexOf('high')
      ? 'high'
      : esfuerzo;
  return conSuelo === 'xhigh' ? 'high' : conSuelo;
}

export interface OpcionesAdaptadorAnthropic {
  papel: PapelModelo;
  plataforma: PlataformaModelo;
  configuracion: Pick<esquemas.ConfiguracionModeloPuesto, 'esfuerzoPorClasePaso'>;
  maxTokens?: number | undefined;
  /**
   * Anula el identificador de modelo que calcula `identificadorDeModelo`. Sirve
   * para fijar, sin tocar `identificadores.ts`, un identificador distinto del de
   * la tabla —por ejemplo, otro perfil de inferencia que confirme el catálogo de
   * modelos de la consola de Bedrock, o el identificador del endpoint de Mensajes
   * cuando AWS conceda acceso, antes de mover la tabla en código—: no se adivina
   * aquí.
   */
  identificadorModelo?: string | undefined;
}

function aTokensDeUso(uso: Anthropic.Usage): TokensDeUso {
  return {
    entrada: uso.input_tokens,
    salida: uso.output_tokens,
    entradaCache: uso.cache_read_input_tokens ?? 0,
  };
}

function textoDe(mensaje: Anthropic.Message): string {
  return mensaje.content
    .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
    .map((bloque) => bloque.text)
    .join('');
}

/** Esquema JSON de un `z.ZodType`, en la forma que admite `strict` (sin las palabras clave que rechaza la API). */
function esquemaEstricto(esquema: z.ZodType): Record<string, unknown> {
  return transformJSONSchema(z.toJSONSchema(esquema, { reused: 'ref' }));
}

function herramientasDe(peticion: PeticionDeModelo): Anthropic.Tool[] | undefined {
  if (!peticion.herramientas || peticion.herramientas.length === 0) return undefined;
  return peticion.herramientas.map((herramienta) => ({
    name: herramienta.nombre,
    description: herramienta.descripcion,
    // Estricto (ADR-018): sin instrucción suelta para pedir el formato, esquema cerrado.
    strict: true,
    input_schema: esquemaEstricto(herramienta.esquemaEntrada) as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Lee las llamadas a herramienta de la respuesta y valida la entrada de cada una
 * contra el esquema Zod original (no el que viajó, ya sin `strict` completo — ver
 * el comentario de cabecera). Un fallo de validación o una herramienta que el
 * modelo pide sin haberla declarado la petición son errores de transporte: los
 * lanza, como el resto de comprobaciones de esta función (ADR-018: un fallo de
 * validación no es un resultado a medio construir).
 */
function llamadasHerramientaDe(
  mensaje: Anthropic.Message,
  herramientas: HerramientaDeModelo[] | undefined,
  modelo: string,
): LlamadaHerramienta[] {
  const bloques = mensaje.content.filter(
    (bloque): bloque is Anthropic.ToolUseBlock => bloque.type === 'tool_use',
  );
  return bloques.map((bloque) => {
    const herramienta = herramientas?.find((candidata) => candidata.nombre === bloque.name);
    if (!herramienta) {
      throw new Error(
        `${modelo} pidió la herramienta "${bloque.name}", que no estaba entre las declaradas en la petición.`,
      );
    }
    const validado = herramienta.esquemaEntrada.safeParse(bloque.input);
    if (!validado.success) {
      throw new Error(
        `${modelo} pidió la herramienta "${bloque.name}" con una entrada que no cumple su esquema: ${validado.error.message}`,
      );
    }
    return { nombre: bloque.name, entrada: validado.data };
  });
}

/**
 * Crea un puerto de modelo sobre un cliente ya construido (Bedrock, Vertex,
 * primera parte o el cliente simulado de pruebas). El adaptador no construye el
 * cliente: eso es responsabilidad de quien lo instala, para que las pruebas
 * inyecten el simulado sin tocar credenciales.
 */
export function crearAdaptadorAnthropic(
  cliente: ClienteDeMensajes,
  opciones: OpcionesAdaptadorAnthropic,
): PuertoDeModelo {
  // Una variable de la CI sin definir llega como cadena vacía (`${{ vars.X }}`),
  // no como `undefined`: vacía cuenta como no anular.
  const anulacion = opciones.identificadorModelo?.trim() || undefined;
  const modelo = anulacion ?? identificadorDeModelo(opciones.papel, opciones.plataforma);
  const sinPensamientoAdaptativo = SIN_PENSAMIENTO_ADAPTATIVO.has(opciones.papel);
  const provisional = anulacion === undefined && esProvisional(opciones.papel, opciones.plataforma);

  return {
    modelo,
    plataforma: opciones.plataforma,
    async completar<T>(peticion: PeticionDeModelo<T>): Promise<RespuestaDeModelo<T>> {
      const esfuerzo = esfuerzoSoportado(
        esfuerzoParaClase(opciones.configuracion, peticion.clasePaso),
        opciones.papel,
        provisional,
      );

      const herramientas = herramientasDe(peticion);
      const params: Anthropic.MessageCreateParamsNonStreaming = {
        model: modelo,
        max_tokens: peticion.maxTokens ?? opciones.maxTokens ?? MAX_TOKENS_POR_DEFECTO,
        ...(peticion.sistema !== undefined ? { system: peticion.sistema } : {}),
        messages: peticion.mensajes.map((mensaje) => ({
          role: mensaje.rol,
          content: mensaje.contenido,
        })),
        ...(herramientas ? { tools: herramientas } : {}),
        output_config: {
          ...(sinPensamientoAdaptativo ? {} : { effort: esfuerzo }),
          ...(peticion.esquemaSalida
            ? { format: { type: 'json_schema', schema: esquemaEstricto(peticion.esquemaSalida) } }
            : {}),
        },
        ...(sinPensamientoAdaptativo ? {} : { thinking: { type: 'adaptive' } }),
      };

      const respuesta = await cliente.messages.create(params);
      const tokens = aTokensDeUso(respuesta.usage);

      if (respuesta.stop_reason === 'refusal') {
        return {
          tipo: 'rechazo',
          categoria: respuesta.stop_details?.category ?? null,
          explicacion: respuesta.stop_details?.explanation ?? null,
          tokens,
          modelo,
        };
      }

      const texto = textoDe(respuesta);
      let salida: T | undefined;
      if (peticion.esquemaSalida) {
        let json: unknown;
        try {
          json = JSON.parse(texto);
        } catch (error) {
          throw new Error(
            `${modelo} devolvió una salida estructurada que no es JSON válido: ${String(error)}`,
            { cause: error },
          );
        }
        const validado = peticion.esquemaSalida.safeParse(json);
        if (!validado.success) {
          throw new Error(
            `${modelo} devolvió una salida que no cumple el esquema pedido: ${validado.error.message}`,
          );
        }
        salida = validado.data;
      }

      const llamadasHerramientas = llamadasHerramientaDe(respuesta, peticion.herramientas, modelo);

      return {
        tipo: 'ok',
        texto,
        ...(salida !== undefined ? { salida } : {}),
        ...(llamadasHerramientas.length > 0 ? { llamadasHerramientas } : {}),
        tokens,
        modelo,
      };
    },
  };
}
