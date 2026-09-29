/**
 * Servidor simulado que reproduce la forma de la API de Mensajes de Anthropic.
 *
 * Es lo único contra lo que se prueba el adaptador de Anthropic mientras no hay
 * credenciales de Bedrock ni de Vertex en la UE (ver el runbook de
 * `docs/runbooks/modelos-funciones-ausentes.md`). No firma peticiones ni valida
 * autenticación: solo responde `POST /v1/messages` con la fixture que le des, para
 * que el adaptador se pruebe de verdad —construcción de la petición, lectura de la
 * respuesta, tratamiento del rechazo, salidas estructuradas— sin nube real detrás.
 */
import { createServer, type Server } from 'node:http';

export interface PeticionRecibida {
  cuerpo: unknown;
  cabeceras: Record<string, string | string[] | undefined>;
}

export interface ServidorSimulado {
  url: string;
  peticiones: PeticionRecibida[];
  cerrar: () => Promise<void>;
}

export type FabricaDeRespuesta = (cuerpo: unknown) => unknown;

/**
 * Arranca el servidor. `respuestas` es una fixture fija, una lista (una por
 * petición, en orden, y se repite la última si llegan más) o una función que
 * decide la respuesta a partir del cuerpo recibido.
 */
export async function iniciarServidorSimulado(
  respuestas: unknown | unknown[] | FabricaDeRespuesta,
): Promise<ServidorSimulado> {
  const peticiones: PeticionRecibida[] = [];
  let indice = 0;

  const servidor: Server = createServer((peticion, respuesta) => {
    const trozos: Buffer[] = [];
    peticion.on('data', (trozo: Buffer) => trozos.push(trozo));
    peticion.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8');
      const cuerpo: unknown = texto.length > 0 ? JSON.parse(texto) : undefined;
      peticiones.push({ cuerpo, cabeceras: peticion.headers });

      let cuerpoRespuesta: unknown;
      if (typeof respuestas === 'function') {
        cuerpoRespuesta = (respuestas as FabricaDeRespuesta)(cuerpo);
      } else if (Array.isArray(respuestas)) {
        cuerpoRespuesta = respuestas[Math.min(indice, respuestas.length - 1)];
        indice += 1;
      } else {
        cuerpoRespuesta = respuestas;
      }

      respuesta.writeHead(200, { 'content-type': 'application/json' });
      respuesta.end(JSON.stringify(cuerpoRespuesta));
    });
  });

  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const direccion = servidor.address();
  if (direccion === null || typeof direccion === 'string') {
    throw new Error('El servidor simulado no pudo abrir un puerto.');
  }

  return {
    url: `http://127.0.0.1:${direccion.port}`,
    peticiones,
    cerrar: () =>
      new Promise<void>((resolve, reject) =>
        servidor.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Fixture mínima de una respuesta de Mensajes con salida de texto. */
export function respuestaDeTexto(texto: string, opciones: { modelo?: string } = {}): unknown {
  return {
    id: 'msg_simulado_01',
    type: 'message',
    role: 'assistant',
    model: opciones.modelo ?? 'claude-sonnet-5',
    content: [{ type: 'text', text: texto }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

/** Fixture de una respuesta de Mensajes en la que el modelo pide una herramienta. */
export function respuestaDeUsoDeHerramienta(
  nombre: string,
  entrada: unknown,
  opciones: { modelo?: string; texto?: string } = {},
): unknown {
  return {
    id: 'msg_simulado_herramienta',
    type: 'message',
    role: 'assistant',
    model: opciones.modelo ?? 'claude-sonnet-5',
    content: [
      ...(opciones.texto !== undefined ? [{ type: 'text', text: opciones.texto }] : []),
      { type: 'tool_use', id: 'toolu_simulado_01', name: nombre, input: entrada },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 150,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}

/** Fixture de un rechazo del clasificador (ADR-018). */
export function respuestaDeRechazo(
  categoria: 'cyber' | 'bio' | 'frontier_llm' | 'reasoning_extraction' | 'general_harms' | null,
  explicacion: string | null = null,
  opciones: { modelo?: string } = {},
): unknown {
  return {
    id: 'msg_simulado_rechazo',
    type: 'message',
    role: 'assistant',
    model: opciones.modelo ?? 'claude-sonnet-5',
    content: [],
    stop_reason: 'refusal',
    stop_sequence: null,
    stop_details: { type: 'refusal', category: categoria, explanation: explicacion },
    container: null,
    usage: {
      input_tokens: 80,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
    },
  };
}
