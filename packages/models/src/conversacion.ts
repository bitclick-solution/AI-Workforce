/**
 * De la conversación que guarda el historial de Temporal a los mensajes del AI SDK.
 *
 * El flujo no puede guardar un `ModelMessage` del AI SDK: en el historial de
 * Temporal entra JSON plano y nada más, y atar el historial al formato interno de
 * una librería sería atarlo a su próxima versión mayor. Así que el flujo guarda una
 * forma propia y mínima —papel, texto, a qué llamada contesta— y la traducción vive
 * aquí, en el paquete que sí conoce el AI SDK.
 *
 * Si mañana el formato del AI SDK cambia, cambia esta función. Los historiales de
 * las tareas que ya corrieron siguen siendo legibles, que es lo que importa cuando
 * una tarea puede reanudarse meses después.
 */
import type { ModelMessage } from 'ai';

import type { MensajeDeModelo } from './puerto.js';

/**
 * Un turno de la conversación en la forma que el historial puede guardar.
 *
 * Se llama turno y no mensaje a propósito: `MensajeDeConversacion` es el nombre que
 * usa el flujo del trabajador para su propio tipo, estructuralmente idéntico, y dos
 * tipos con el mismo nombre exportados desde dos paquetes que se reexportan juntos
 * chocan al compilar. El flujo pasa el suyo y encaja por estructura.
 */
export interface TurnoDeConversacion {
  papel: 'usuario' | 'agente' | 'herramienta';
  texto: string;
  /** Presente en los mensajes de herramienta: a qué llamada contesta. */
  llamadaId?: string | undefined;
  herramienta?: string | undefined;
  /** Presente en el turno del agente que pidió herramientas: qué pidió, para devolverlo al modelo. */
  llamadas?:
    readonly { id: string; herramienta: string; argumentos: Record<string, unknown> }[] | undefined;
  /**
   * Presente en el turno del agente cuando lo sirvió un proveedor real: el contenido
   * original del modelo (`RespuestaDeModeloOk.bloques`), opaco. Los historiales de
   * antes de esta rebanada no lo traen.
   */
  bloques?: readonly unknown[] | undefined;
}

export function mensajesParaElModelo(conversacion: readonly TurnoDeConversacion[]): ModelMessage[] {
  const mensajes: ModelMessage[] = [];

  for (const mensaje of conversacion) {
    if (mensaje.papel === 'usuario') {
      mensajes.push({ role: 'user', content: mensaje.texto });
      continue;
    }
    if (mensaje.papel === 'agente') {
      // Un turno del agente sin texto no aporta nada y algunos proveedores
      // rechazan un mensaje vacío: se omite.
      if (mensaje.texto !== '') mensajes.push({ role: 'assistant', content: mensaje.texto });
      continue;
    }
    mensajes.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: mensaje.llamadaId ?? 'sin-id',
          toolName: mensaje.herramienta ?? 'desconocida',
          output: { type: 'text', value: mensaje.texto },
        },
      ],
    });
  }

  return mensajes;
}

/**
 * De la conversación del historial a los mensajes del puerto de Modelos v1.
 *
 * A diferencia del AI SDK, la API de Mensajes exige que cada resultado de
 * herramienta conteste a una llamada del turno anterior del asistente y que todos
 * los resultados de un turno vayan juntos en un solo mensaje del usuario. Un
 * resultado que no encuentra su llamada (un historial anterior a que el turno del
 * agente guardara las suyas) se entrega como texto del usuario en vez de romper la
 * petición.
 */
export function mensajesParaElPuerto(
  conversacion: readonly TurnoDeConversacion[],
): MensajeDeModelo[] {
  const mensajes: MensajeDeModelo[] = [];

  for (const turno of conversacion) {
    if (turno.papel === 'usuario') {
      mensajes.push({ rol: 'user', contenido: turno.texto });
      continue;
    }

    if (turno.papel === 'agente') {
      const llamadas = (turno.llamadas ?? []).map((llamada) => ({
        id: llamada.id,
        nombre: llamada.herramienta,
        entrada: llamada.argumentos,
      }));
      const vacio =
        turno.texto === '' && llamadas.length === 0 && (turno.bloques ?? []).length === 0;
      if (vacio) continue;
      mensajes.push({
        rol: 'assistant',
        contenido: turno.texto,
        ...(llamadas.length > 0 ? { llamadas } : {}),
        ...(turno.bloques && turno.bloques.length > 0 ? { bloques: turno.bloques } : {}),
      });
      continue;
    }

    const anterior = mensajes.at(-1);
    // Las llamadas que hay que contestar son las del último turno del asistente,
    // siempre que los resultados vayan justo detrás de él.
    const ultimoAsistente = mensajes.filter((mensaje) => mensaje.rol === 'assistant').at(-1);
    const detrasDelAsistente =
      anterior === ultimoAsistente ||
      (anterior?.rol === 'user' && anterior.resultados !== undefined);
    const idsPedidos = new Set(
      detrasDelAsistente ? (ultimoAsistente?.llamadas ?? []).map((llamada) => llamada.id) : [],
    );
    const contesta = turno.llamadaId !== undefined && idsPedidos.has(turno.llamadaId);
    if (!contesta) {
      mensajes.push({
        rol: 'user',
        contenido: `Resultado de ${turno.herramienta ?? 'la herramienta'}: ${turno.texto}`,
      });
      continue;
    }

    const resultado = { llamadaId: turno.llamadaId as string, contenido: turno.texto };
    if (anterior?.rol === 'user' && anterior.resultados) {
      mensajes[mensajes.length - 1] = {
        ...anterior,
        resultados: [...anterior.resultados, resultado],
      };
    } else {
      mensajes.push({ rol: 'user', contenido: '', resultados: [resultado] });
    }
  }

  return mensajes;
}
