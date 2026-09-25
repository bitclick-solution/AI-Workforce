/**
 * Flujos durables de Temporal: `tareaAgente` y `delegacion`.
 *
 * Este módulo es la mitad determinista del trabajador. Se compila a un paquete
 * aislado sin acceso a la red ni al reloj del sistema, y se puede volver a ejecutar
 * desde el historial tantas veces como haga falta dando siempre lo mismo. Todo lo
 * que tenga efectos está detrás de un proxy de actividad.
 *
 * Los reintentos se declaran por actividad y no por flujo. El criterio: lo que
 * habla con un sistema de fuera reintenta con espera creciente y tope corto —cuatro
 * fallos seguidos del conector significan que el conector está roto, no que haya que
 * insistir—; lo que solo escribe en nuestra base reintenta mucho más, porque una
 * base que no responde vuelve y perder el paso sería peor, pero también con tope. Y
 * lo que es un error de datos y no una caída se marca como no reintentable en la
 * actividad, así que no espera ni un segundo.
 */
import {
  ApplicationFailure,
  ParentClosePolicy,
  condition,
  isCancellation,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
  type ChildWorkflowHandle,
} from '@temporalio/workflow';
import { contratoDelegacion, type CargaSenalDecision, type ContratoDelegacion } from '@aiw/domain';

import { ejecutarBucle, type OperacionesDelBucle } from '../bucle/bucle.js';
import type {
  DecisionRecibida,
  DelegacionAbierta,
  EntradaDelegacion,
  EntradaTareaAgente,
  ResultadoDelegacionHija,
  ResultadoTareaAgente,
} from '../bucle/tipos.js';
import type { Actividades } from '../actividades/index.js';
import { PREFIJO_FLUJO_APRENDIZAJE, aprendizajeDeSenal } from './aprendizaje.js';

/**
 * Nombre de la señal. Es el mismo valor que `AIW_SENAL_NOMBRE` en `.env.example` y
 * el que usa `apps/channels`: si los dos no coinciden, la decisión no llega a nadie.
 */
export const NOMBRE_SENAL_DECISION = 'decisionDeAprobacion';

export const decisionDeAprobacion = defineSignal<[CargaSenalDecision]>(NOMBRE_SENAL_DECISION);

/** Consulta el estado que el flujo proyectaría. Permite reconstruir la proyección. */
export const estadoDeLaTarea = defineQuery<EstadoProyectado>('estadoDeLaTarea');

export interface EstadoProyectado {
  estado: 'pendiente' | 'en_curso' | 'esperando_aprobacion' | 'completada' | 'fallida';
  pasos: number;
  aprobacionesPendientes: string[];
}

/** Reintentos de lo que habla con un sistema de fuera. */
const REINTENTOS_EXTERNOS = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '30 seconds',
  // Cuatro intentos: el primero y tres reintentos con espera creciente. Al cuarto
  // fallo la tarea se da por fallida con el motivo, que es lo que pide el criterio 2.
  maximumAttempts: 4,
} as const;

/**
 * Reintentos de lo que solo escribe en nuestra base.
 *
 * Mucho más generoso que el de fuera —una base que no responde vuelve, y perder el
 * paso sería peor— pero con tope. El tope existe por una lección de la integración
 * continua: una carga que la base rechaza siempre no mejora por insistir, y sin tope
 * una actividad así se reintenta durante horas y se come el trabajador. Veinte
 * minutos es tiempo de sobra para una caída de PostgreSQL y bastante poco para no
 * dejar un flujo girando en vacío.
 *
 * Lo que sí es un error de datos y no una caída se marca como no reintentable en la
 * propia actividad, y entonces no espera ni un segundo.
 */
const REINTENTOS_INTERNOS = {
  initialInterval: '500 milliseconds',
  backoffCoefficient: 2,
  maximumInterval: '10 seconds',
  maximumAttempts: 120,
} as const;

const externas = proxyActivities<Pick<Actividades, 'pasoModelo' | 'pasoHerramienta'>>({
  startToCloseTimeout: '2 minutes',
  retry: REINTENTOS_EXTERNOS,
});

const internas = proxyActivities<
  Pick<
    Actividades,
    | 'arrancarTarea'
    | 'leerContexto'
    | 'pedirAprobacion'
    | 'leerDecision'
    | 'vencerAprobacion'
    | 'anotarPaso'
    | 'senalDeAprendizaje'
    | 'proyectarEstado'
    | 'abrirDelegacion'
    | 'cerrarDelegacion'
  >
>({
  startToCloseTimeout: '1 minute',
  retry: REINTENTOS_INTERNOS,
});

/**
 * Valida el contrato al entrar en el flujo y, si no cumple, hace fallar la ejecución.
 *
 * Tiene que ser un `ApplicationFailure` no reintentable y no el error de Zod: un
 * error corriente lanzado desde el código del flujo es un fallo de la tarea de
 * flujo, y Temporal la reintenta sin fin esperando a que el código se arregle. Lo
 * enseñó la integración continua: un contrato sin caducidad dejaba el flujo girando
 * hasta que la prueba se rendía por tiempo.
 */
function validarContrato(contrato: unknown): ContratoDelegacion {
  const resultado = contratoDelegacion.safeParse(contrato);
  if (resultado.success) return resultado.data;
  throw ApplicationFailure.create({
    message:
      'El contrato de la delegación no cumple el ADR-014: ' +
      resultado.error.issues
        .map((problema) => `${problema.path.join('.') || '(raíz)'}: ${problema.message}`)
        .join('; '),
    type: 'ContratoDeDelegacionNoValido',
    nonRetryable: true,
  });
}

/** Mensajes de un error y de sus causas, del más externo al más profundo, sin repetir. */
function mensajesDeLaCadena(error: unknown): string[] {
  const mensajes: string[] = [];
  let actual: unknown = error;
  while (actual instanceof Error) {
    if (actual.message && !mensajes.includes(actual.message)) mensajes.push(actual.message);
    actual = actual.cause;
  }
  if (mensajes.length === 0) mensajes.push(String(error));
  return mensajes;
}

/**
 * Flujo de una tarea de agente.
 *
 * Arranca, cuenta la tarea, ejecuta el bucle y proyecta el estado. Las aprobaciones
 * entran por señal; si el flujo se reanuda después de que alguien decidiera, la
 * decisión se recupera de la base y no se espera a nadie.
 */
export async function tareaAgente(entrada: EntradaTareaAgente): Promise<ResultadoTareaAgente> {
  // El contrato de la delegación se valida al entrar y no al abrirla. Es la
  // diferencia entre un flujo que falla en su primer milisegundo diciendo qué campo
  // falta y uno que ejecuta la tarea entera para tropezar al final con una carga que
  // la base rechaza. Lo aprendí de la integración continua: un contrato sin
  // `politicaRespaldo` llegaba hasta `anotar`, que lo rechazaba, y la actividad se
  // reintentaba sesenta veces.
  const contratoDeLaDelegacion = entrada.delegacion
    ? validarContrato(entrada.delegacion.contrato)
    : undefined;

  const info = workflowInfo();
  const decisiones = new Map<string, CargaSenalDecision>();
  let pasosDados = 0;
  const pendientes = new Set<string>();
  let estado: EstadoProyectado['estado'] = 'pendiente';

  setHandler(decisionDeAprobacion, (carga) => {
    // La señal puede llegar antes de que el flujo la espere: se guarda y el bucle
    // la encuentra cuando llegue. Una señal perdida por llegar pronto sería un
    // flujo esperando algo que ya pasó.
    decisiones.set(carga.aprobacionId, carga);
  });
  setHandler(estadoDeLaTarea, () => ({
    estado,
    pasos: pasosDados,
    aprobacionesPendientes: [...pendientes],
  }));

  await internas.arrancarTarea({
    tenantId: entrada.tenantId,
    tareaId: entrada.tareaId,
    puestoId: entrada.puestoId,
    versionPuestoId: entrada.versionPuestoId,
    flujoTemporalId: info.workflowId,
    ejecucionTemporalId: info.runId,
  });
  estado = 'en_curso';

  const identidad = {
    tenantId: entrada.tenantId,
    puestoId: entrada.puestoId,
    versionPuestoId: entrada.versionPuestoId,
    tareaId: entrada.tareaId,
  };

  const operaciones: OperacionesDelBucle = {
    // Una intervención en la sala es de solo lectura (docs/specs/sala-v0.md,
    // decisión 3): el modelo no ve las herramientas de escritura, así que ni puede
    // pedirlas. Se filtra en cada lectura del contexto, no una vez al empezar.
    leerContexto: async () => {
      const contexto = await internas.leerContexto(identidad);
      return entrada.soloLectura === true
        ? { ...contexto, herramientas: contexto.herramientas.filter((h) => h.tipo === 'lectura') }
        : contexto;
    },

    async pasoModelo(peticion) {
      const salida = await externas.pasoModelo(peticion);
      pasosDados += 1;
      return salida;
    },

    pasoHerramienta: (peticion) => externas.pasoHerramienta(peticion),

    async pedirAprobacion(peticion) {
      const creada = await internas.pedirAprobacion(peticion);
      pendientes.add(creada.aprobacionId);
      estado = 'esperando_aprobacion';
      await internas.proyectarEstado({
        tenantId: entrada.tenantId,
        tareaId: entrada.tareaId,
        estado: 'esperando_aprobacion',
        resultado: { esperando: creada.aprobacionId },
      });
      return creada;
    },

    async esperarDecision(aprobacionId, validezSegundos) {
      // Primero la base: si la decisión ya está registrada, la señal se perdió por
      // una caída del trabajador y esperarla sería esperar para siempre.
      const registrada = await internas.leerDecision({
        tenantId: entrada.tenantId,
        aprobacionId,
      });
      if (registrada) {
        pendientes.delete(aprobacionId);
        estado = 'en_curso';
        return registrada;
      }

      const llego = await condition(
        () => decisiones.has(aprobacionId),
        `${validezSegundos} seconds`,
      );
      pendientes.delete(aprobacionId);
      estado = 'en_curso';

      if (!llego) {
        // Nadie contestó. La plataforma la vence y el bucle sigue con el rechazo.
        return internas.vencerAprobacion({
          tenantId: entrada.tenantId,
          aprobacionId,
          motivo: 'Vencida sin respuesta durante la ejecución del flujo',
        });
      }

      const carga = decisiones.get(aprobacionId);
      if (carga?.sentido === 'editada') {
        // La señal dice que se editó, pero no trae lo editado: la carga de la señal
        // es pequeña a propósito. Lo editado está en la base, junto a la decisión.
        const conEdicion = await internas.leerDecision({
          tenantId: entrada.tenantId,
          aprobacionId,
        });
        if (conEdicion) return conEdicion;
      }
      const decidida: DecisionRecibida = {
        aprobacionId,
        sentido: carga?.sentido ?? 'rechazada',
        personaId: carga?.personaId ?? null,
        ...(carga?.motivo === undefined ? {} : { motivo: carga.motivo }),
      };
      return decidida;
    },

    anotarPaso: (peticion) => internas.anotarPaso(peticion),
    senalDeAprendizaje: (peticion) => internas.senalDeAprendizaje(peticion),
    aprenderDeEdicion:
      entrada.aprendizaje === true
        ? async (aprobacionId) => {
            // Hijo abandonado: el aprendizaje no retrasa la tarea ni la hace fallar,
            // y sigue aunque la tarea termine antes. Uno por aprobación editada.
            try {
              await startChild(aprendizajeDeSenal, {
                workflowId: `${PREFIJO_FLUJO_APRENDIZAJE}${aprobacionId}`,
                args: [{ tenantId: entrada.tenantId, aprobacionId }],
                parentClosePolicy: ParentClosePolicy.ABANDON,
              });
            } catch (error) {
              // Solo sube la cancelación de la propia tarea. Si ya hay un flujo para
              // esta edición (la tarea se reinició después de lanzarlo), no pasa
              // nada: el aprendizaje es idempotente por aprobación. Cualquier otro
              // fallo al lanzar el hijo no puede tumbar la tarea: el aprendizaje no
              // es parte del trabajo. Se anota como incidencia y la tarea sigue.
              if (isCancellation(error)) throw error;
              if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
                return;
              }
              try {
                await internas.senalDeAprendizaje({
                  ...identidad,
                  tipo: 'incidencia',
                  resumen: 'No se pudo lanzar el flujo de aprendizaje de una edición.',
                  detalle: {
                    aprobacionId,
                    error: error instanceof Error ? error.message : String(error),
                  },
                  puntuacion: 0,
                });
              } catch (errorAlAnotar) {
                // Ni siquiera anotar la incidencia puede tumbar la tarea: la edición
                // sigue en `decision_aprobacion` y se puede aprender de ella después.
                if (isCancellation(errorAlAnotar)) throw errorAlAnotar;
              }
            }
          }
        : undefined,
    abrirDelegacion: (peticion) => internas.abrirDelegacion(peticion),

    /**
     * Lanza el hijo y espera con el plazo del contrato.
     *
     * `Promise.race` entre el resultado y un temporizador del reloj de Temporal, que
     * es lo que hace que el plazo sobreviva a una caída: el temporizador vive en el
     * historial y no en el proceso. Devuelve nulo al vencer, y el bucle aplica la
     * política de respaldo del ADR-014.
     */
    async esperarDelegacion(abierta: DelegacionAbierta, plazoSegundos: number) {
      if (!entrada.delegacion || !contratoDeLaDelegacion) return null;
      const contrato = contratoDeLaDelegacion;

      const hijo: ChildWorkflowHandle<typeof delegacion> = await startChild(delegacion, {
        workflowId: `delegacion-${abierta.delegacionId}`,
        args: [
          {
            tenantId: entrada.tenantId,
            puestoId: abierta.puestoDestinoId,
            versionPuestoId: abierta.versionPuestoDestinoId,
            tareaId: abierta.tareaDestinoId,
            delegacionId: abierta.delegacionId,
            tareaOrigenId: entrada.tareaId,
            // El presupuesto que va al hijo es el acotado por la actividad, no el
            // pedido: el hijo no debe saber más de lo que la base le concedió.
            contrato: { ...contrato, presupuestoEuros: abierta.presupuestoEuros },
          },
        ],
        // El hijo hereda el registro y el consumo, pero no la vida del padre: si el
        // padre termina, el hijo se abandona en vez de morirse a medias.
        parentClosePolicy: 'ABANDON',
        // La caducidad del ADR-014 es el tope de vida del hijo: pasada, no hay
        // petición que cumplir y Temporal lo cierra por sí mismo.
        workflowExecutionTimeout: `${contrato.caducidadSegundos} seconds`,
      });

      const vencido = Symbol('plazo');
      const resultado = await Promise.race([
        hijo.result(),
        sleep(`${plazoSegundos} seconds`).then(() => vencido),
      ]);
      return resultado === vencido ? null : (resultado as ResultadoDelegacionHija);
    },

    cerrarDelegacion: (delegacionId, resultado) =>
      internas.cerrarDelegacion({ tenantId: entrada.tenantId, delegacionId, resultado }),
  };

  try {
    const resultado = await ejecutarBucle(operaciones, entrada);
    estado = resultado.estado === 'esperando_aprobacion' ? 'esperando_aprobacion' : 'completada';
    await internas.proyectarEstado({
      tenantId: entrada.tenantId,
      tareaId: entrada.tareaId,
      estado: resultado.estado,
      resultado: { ...resultado },
    });
    return resultado;
  } catch (error) {
    // Al cuarto fallo del conector, la actividad se rinde y el flujo cae aquí: la
    // tarea pasa a fallida con el motivo en `resultado`, que es lo que hay que poder
    // leer en el panel sin abrir Temporal.
    estado = 'fallida';
    // Lo que llega aquí es el envoltorio de Temporal («Activity task failed»); lo que
    // pasó de verdad está al fondo de la cadena de causas, y eso es lo que tiene que
    // poder leerse en la fila de la tarea sin abrir Temporal.
    const causas = mensajesDeLaCadena(error);
    const motivo = causas[causas.length - 1] ?? String(error);
    await internas.proyectarEstado({
      tenantId: entrada.tenantId,
      tareaId: entrada.tareaId,
      estado: 'fallida',
      resultado: { motivo, pasos: pasosDados, ...(causas.length > 1 ? { causas } : {}) },
    });
    throw ApplicationFailure.create({
      message: `La tarea ${entrada.tareaId} falló: ${motivo}`,
      type: 'TareaFallida',
      nonRetryable: true,
    });
  }
}

/**
 * Flujo hijo de una delegación.
 *
 * Recibe el contrato completo y lo valida al entrar: un encargo que no cumple el
 * contrato falla en el hijo y el padre lo ve como una delegación fallida, no como un
 * hijo que hace lo que puede con lo que le llegó.
 *
 * Corre el mismo bucle que el padre, con el presupuesto del contrato y sin
 * delegación propia: la profundidad máxima de esta rebanada es uno.
 */
export async function delegacion(entrada: EntradaDelegacion): Promise<ResultadoDelegacionHija> {
  const contrato = validarContrato(entrada.contrato);
  const info = workflowInfo();

  await internas.arrancarTarea({
    tenantId: entrada.tenantId,
    tareaId: entrada.tareaId,
    puestoId: entrada.puestoId,
    versionPuestoId: entrada.versionPuestoId,
    flujoTemporalId: info.workflowId,
    ejecucionTemporalId: info.runId,
  });

  const identidad = {
    tenantId: entrada.tenantId,
    puestoId: entrada.puestoId,
    versionPuestoId: entrada.versionPuestoId,
    tareaId: entrada.tareaId,
  };

  const operaciones: OperacionesDelBucle = {
    leerContexto: () => internas.leerContexto(identidad),
    pasoModelo: (peticion) => externas.pasoModelo(peticion),
    pasoHerramienta: (peticion) => externas.pasoHerramienta(peticion),
    pedirAprobacion: (peticion) => internas.pedirAprobacion(peticion),
    // Un hijo no espera aprobaciones humanas en esta rebanada: si su política se lo
    // exige, la aprobación queda pedida y la petición se rechaza por vencimiento en
    // vez de bloquear al padre más allá de su plazo.
    esperarDecision: (aprobacionId) =>
      internas.vencerAprobacion({
        tenantId: entrada.tenantId,
        aprobacionId,
        motivo: 'Un flujo hijo no espera decisiones humanas: el padre tiene su plazo',
      }),
    anotarPaso: (peticion) => internas.anotarPaso(peticion),
    senalDeAprendizaje: (peticion) => internas.senalDeAprendizaje(peticion),
  };

  const resultado = await ejecutarBucle(operaciones, {
    ...identidad,
    encargo: contrato.encargo,
    maxPasos: 4,
  });

  await internas.proyectarEstado({
    tenantId: entrada.tenantId,
    tareaId: entrada.tareaId,
    estado: resultado.estado === 'completada' ? 'completada' : 'fallida',
    resultado: { ...resultado, delegacionId: entrada.delegacionId },
  });

  return {
    tareaDestinoId: entrada.tareaId,
    entregado: resultado.estado === 'completada',
    resumen: resultado.resumen,
    costeEuros: resultado.costeEuros,
  };
}

// Sala v0: moderación, intervenciones y propuestas de operación.
export * from './sala.js';

// Aprendizaje v0: de la edición del borrador a la lección propuesta.
export * from './aprendizaje.js';
