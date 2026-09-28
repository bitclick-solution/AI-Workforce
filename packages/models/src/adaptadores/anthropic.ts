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
 */
import type Anthropic from '@anthropic-ai/sdk';
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

function herramientasDe(peticion: PeticionDeModelo): Anthropic.Tool[] | undefined {
  if (!peticion.herramientas || peticion.herramientas.length === 0) return undefined;
  return peticion.herramientas.map((herramienta) => ({
    name: herramienta.nombre,
    description: herramienta.descripcion,
    // Estricto (ADR-018): sin instrucción suelta para pedir el formato, esquema cerrado.
    strict: true,
    input_schema: z.toJSONSchema(herramienta.esquemaEntrada) as Anthropic.Tool.InputSchema,
  }));
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
            ? { format: { type: 'json_schema', schema: z.toJSONSchema(peticion.esquemaSalida) } }
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

      return { tipo: 'ok', texto, ...(salida !== undefined ? { salida } : {}), tokens, modelo };
    },
  };
}
