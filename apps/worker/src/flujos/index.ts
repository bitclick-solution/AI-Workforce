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
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  startChild,
  workflowInfo,
  type ChildWorkflowHandle,
} from '@temporalio/workflow';
import { contratoDelegacion, type CargaSenalDecision } from '@aiw/domain';

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
    ? contratoDelegacion.parse(entrada.delegacion.contrato)
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
    leerContexto: () => internas.leerContexto(identidad),

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
            contrato,
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
    const motivo = error instanceof Error ? error.message : String(error);
    await internas.proyectarEstado({
      tenantId: entrada.tenantId,
      tareaId: entrada.tareaId,
      estado: 'fallida',
      resultado: { motivo, pasos: pasosDados },
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
  const contrato = contratoDelegacion.parse(entrada.contrato);
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
