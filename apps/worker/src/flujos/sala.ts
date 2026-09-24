/**
 * Flujos de la sala v0: `mensajeDeSala` y `propuestaDeOperacion`.
 *
 * El mensaje humano es un flujo propio con el identificador del mensaje: publicar
 * dos veces no modera dos. Cada intervención es una tarea ligera con su flujo hijo
 * `tareaAgente` (ADR-004), en solo lectura. La contratación es otro flujo, que
 * sobrevive al del mensaje y espera el clic con caducidad (ADR-014).
 *
 * Como todo flujo, es determinista: los identificadores los da una actividad y el
 * reloj es el de Temporal.
 */
import {
  ParentClosePolicy,
  condition,
  defineSignal,
  executeChild,
  proxyActivities,
  setHandler,
  startChild,
} from '@temporalio/workflow';
import {
  SENAL_DECISION_PROPUESTA,
  idFlujoPropuesta,
  type CargaDecisionPropuesta,
  type EntradaMensajeDeSala,
} from '@aiw/rooms';

import type { Actividades } from '../actividades/index.js';
import type { tareaAgente } from './index.js';

/**
 * Mismos reintentos que las actividades internas de `tareaAgente`: todo lo de la
 * sala escribe solo en nuestra base. Se repiten aquí y no se importan para que este
 * módulo no dependa en valor del índice que lo reexporta.
 */
const sala = proxyActivities<
  Pick<
    Actividades,
    | 'nuevosIdentificadores'
    | 'publicarMensajeHumano'
    | 'moderarMensaje'
    | 'abrirIntervencion'
    | 'publicarRespuesta'
    | 'proponerOperacion'
    | 'decidirPropuesta'
    | 'ejecutarContratacion'
  >
>({
  startToCloseTimeout: '1 minute',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
    maximumAttempts: 120,
  },
});

/** Vueltas del bucle de una intervención: listar y responder caben en cuatro. */
const PASOS_DE_INTERVENCION = 4;

export interface ResultadoMensajeDeSala {
  decision: 'intervenir' | 'operacion' | 'silencio';
  intervenciones: { puestoId: string; tareaId: string; estado: string }[];
  propuestaId: string | null;
}

export async function mensajeDeSala(
  entrada: EntradaMensajeDeSala,
): Promise<ResultadoMensajeDeSala> {
  const { tenantId, salaId, mensajeId } = entrada;
  const [notaId = '', respuestaDirectorId = '', propuestaId = ''] =
    await sala.nuevosIdentificadores({ cantidad: 3 });

  const publicado = await sala.publicarMensajeHumano(entrada);
  const { decision } = await sala.moderarMensaje({
    tenantId,
    salaId,
    mensajeId,
    texto: entrada.texto,
    notaId,
  });

  if (decision.tipo === 'intervenir') {
    const intervenciones: ResultadoMensajeDeSala['intervenciones'] = [];
    // En orden y no en paralelo: con una o dos intervenciones la sala se lee mejor
    // así, y la segunda puede ver lo que dijo la primera cuando haya hilos.
    for (const turno of decision.turnos) {
      const [intervencionId = '', tareaId = '', respuestaId = ''] =
        await sala.nuevosIdentificadores({ cantidad: 3 });
      const abierta = await sala.abrirIntervencion({
        tenantId,
        salaId,
        mensajeId,
        mensajeCreadoEn: publicado.creadoEn,
        puestoId: turno.puestoId,
        motivo: turno.motivo,
        intervencionId,
        tareaId,
      });

      let texto: string;
      let estado: string;
      try {
        const resultado = await executeChild<typeof tareaAgente>('tareaAgente', {
          workflowId: `intervencion-${intervencionId}`,
          args: [
            {
              tenantId,
              puestoId: abierta.puestoId,
              versionPuestoId: abierta.versionPuestoId,
              tareaId: abierta.tareaId,
              encargo: entrada.texto,
              soloLectura: true,
              maxPasos: PASOS_DE_INTERVENCION,
            },
          ],
        });
        texto = resultado.resumen;
        estado = resultado.estado;
      } catch {
        // La tarea hija ya dejó su fallo en el libro y en su fila. La sala no se
        // queda callada: dice que no pudo, sin detalles técnicos.
        texto = `${turno.nombre} no ha podido responder ahora. Queda registrado en su tarea.`;
        estado = 'fallida';
      }
      await sala.publicarRespuesta({
        tenantId,
        salaId,
        mensajeId: respuestaId,
        texto,
        puestoId: abierta.puestoId,
        tareaId: abierta.tareaId,
        adjuntos: [{ tipo: 'intervencion', intervencionId, tareaId: abierta.tareaId, estado }],
      });
      intervenciones.push({ puestoId: abierta.puestoId, tareaId: abierta.tareaId, estado });
    }
    return { decision: 'intervenir', intervenciones, propuestaId: null };
  }

  if (decision.tipo === 'operacion') {
    const propuesta = await sala.proponerOperacion({
      tenantId,
      salaId,
      mensajeId,
      personaId: entrada.personaId,
      texto: entrada.texto,
      propuestaId,
      respuestaId: respuestaDirectorId,
    });
    if (propuesta.propuestaId !== null) {
      await startChild(propuestaDeOperacion, {
        workflowId: idFlujoPropuesta(propuesta.propuestaId),
        // La propuesta espera días; el mensaje termina en segundos.
        parentClosePolicy: ParentClosePolicy.ABANDON,
        args: [
          {
            tenantId,
            salaId,
            propuestaId: propuesta.propuestaId,
            caducidadSegundos: propuesta.caducidadSegundos,
          },
        ],
      });
    }
    return { decision: 'operacion', intervenciones: [], propuestaId: propuesta.propuestaId };
  }

  return { decision: 'silencio', intervenciones: [], propuestaId: null };
}

export const decisionDePropuesta = defineSignal<[CargaDecisionPropuesta]>(SENAL_DECISION_PROPUESTA);

export interface EntradaPropuestaDeOperacion {
  tenantId: string;
  salaId: string;
  propuestaId: string;
  caducidadSegundos: number;
}

export interface ResultadoPropuestaDeOperacion {
  estado: 'ejecutada' | 'rechazada' | 'caducada';
  puestoId: string | null;
}

function esDecision(carga: unknown): carga is CargaDecisionPropuesta {
  const posible = carga as Partial<CargaDecisionPropuesta> | null;
  return (
    typeof posible?.personaId === 'string' &&
    (posible.sentido === 'aprobada' || posible.sentido === 'rechazada')
  );
}

export async function propuestaDeOperacion(
  entrada: EntradaPropuestaDeOperacion,
): Promise<ResultadoPropuestaDeOperacion> {
  const pendientes: CargaDecisionPropuesta[] = [];
  setHandler(decisionDePropuesta, (carga) => {
    // Una señal mal formada se ignora: no puede hacer fallar la propuesta.
    if (esDecision(carga)) pendientes.push(carga);
  });

  const [avisoId = '', presentacionId = ''] = await sala.nuevosIdentificadores({ cantidad: 2 });
  const vence = Date.now() + entrada.caducidadSegundos * 1000;

  for (;;) {
    const restante = Math.max(0, vence - Date.now());
    const llego = await condition(() => pendientes.length > 0, restante);
    const decision = pendientes.shift();
    if (!llego || !decision) {
      await sala.decidirPropuesta({
        tenantId: entrada.tenantId,
        propuestaId: entrada.propuestaId,
        sentido: 'caducada',
        personaId: null,
        salaId: entrada.salaId,
        avisoId,
      });
      return { estado: 'caducada', puestoId: null };
    }

    let estado: string;
    try {
      ({ estado } = await sala.decidirPropuesta({
        tenantId: entrada.tenantId,
        propuestaId: entrada.propuestaId,
        sentido: decision.sentido,
        personaId: decision.personaId,
        motivo: decision.motivo,
        salaId: entrada.salaId,
        avisoId,
      }));
    } catch {
      // Una decisión de alguien que no puede decidir (persona inexistente o
      // inactiva) no cierra la propuesta: se sigue esperando hasta la caducidad.
      continue;
    }

    // `ejecutada` llega si el flujo se reanuda tras ejecutarla: repetir es inocuo.
    if (estado === 'aprobada' || estado === 'ejecutada') {
      const contratado = await sala.ejecutarContratacion({
        tenantId: entrada.tenantId,
        propuestaId: entrada.propuestaId,
        salaId: entrada.salaId,
        presentacionId,
      });
      return { estado: 'ejecutada', puestoId: contratado.puestoId };
    }
    return { estado: 'rechazada', puestoId: null };
  }
}
