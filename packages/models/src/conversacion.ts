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
