/**
 * El bucle del agente. Código propio, sin framework.
 *
 * Planifica, llama a una herramienta, evalúa y decide. Antes y después de cada
 * paso pasa por cinco ganchos: política, presupuesto, guardias, auditoría y señal
 * de aprendizaje. Esa es la frontera de arquitectura de `CLAUDE.md` y la razón de
 * no adoptar ningún framework de agentes: los ganchos no son un añadido al bucle,
 * son el bucle.
 *
 * Este módulo no tiene efectos. No conoce Temporal, ni PostgreSQL, ni el AI SDK:
 * recibe las operaciones y las llama. Dos consecuencias, y las dos hacen falta:
 *
 * - En el flujo de Temporal las operaciones son proxies de actividad, así que el
 *   bucle es código de flujo y cada paso queda en el historial. Por eso no hay aquí
 *   ni `Date.now()`, ni `Math.random()`, ni un `for await` sobre nada asíncrono que
 *   no sea una operación: el flujo se tiene que poder repetir desde el historial y
 *   dar exactamente lo mismo.
 * - En las pruebas las operaciones son funciones normales contra la base real, así
 *   que la tabla de políticas, el presupuesto y la auditoría se comprueban sin
 *   necesitar un servidor de Temporal.
 */
import {
  decidirPaso,
  evaluarPresupuesto,
  resolverRespaldo,
  type Nivel,
  type PoliticaRespaldo,
  type VeredictoPolitica,
} from '@aiw/domain';

import type {
  AprobacionCreada,
  ContextoDeEjecucion,
  DecisionRecibida,
  DelegacionAbierta,
  EntradaTareaAgente,
  HerramientaDelCatalogo,
  MensajeDeConversacion,
  PeticionAbrirDelegacion,
  PeticionAnotarPaso,
  PeticionCargarHabilidad,
  PeticionDeAprobacion,
  PeticionPasoHerramienta,
  PeticionPasoModelo,
  PeticionSenalDeAprendizaje,
  ResultadoDelegacionHija,
  ResultadoTareaAgente,
  SalidaCargaHabilidad,
  SalidaPasoHerramienta,
  SalidaPasoModelo,
} from './tipos.js';

/** Clase de acción con la que se anota la parada por presupuesto. */
export const CLASE_AMPLIACION = 'presupuesto.ampliacion';

/**
 * Nombre de la herramienta sintética `cargar_habilidad`. `leerContexto` solo la
 * añade al catálogo cuando la versión tiene habilidades congeladas (criterio 1 de
 * docs/specs/habilidades-en-el-bucle-y-catalogo-finanzas.md): sin habilidades, el
 * contexto no cambia respecto a antes de esta rebanada.
 */
export const NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD = 'cargar_habilidad';

/** Tope de vueltas por defecto. Un modelo que no sabe parar no para la tarea. */
export const MAX_PASOS_POR_DEFECTO = 8;

/** Validez por defecto de una aprobación, en segundos: tres días laborables. */
export const VALIDEZ_APROBACION_POR_DEFECTO = 72 * 60 * 60;

/**
 * Lo que el bucle necesita del mundo. Cada método es una actividad de Temporal en
 * producción y una función normal en las pruebas.
 */
export interface OperacionesDelBucle {
  /** Lee catálogo, política, estado del puesto y presupuesto. Se vuelve a llamar. */
  leerContexto(): Promise<ContextoDeEjecucion>;
  pasoModelo(peticion: PeticionPasoModelo): Promise<SalidaPasoModelo>;
  pasoHerramienta(peticion: PeticionPasoHerramienta): Promise<SalidaPasoHerramienta>;
  pedirAprobacion(peticion: PeticionDeAprobacion): Promise<AprobacionCreada>;
  /** Espera la decisión. En el flujo, una señal; en las pruebas, una promesa. */
  esperarDecision(aprobacionId: string, validezSegundos: number): Promise<DecisionRecibida>;
  anotarPaso(peticion: PeticionAnotarPaso): Promise<void>;
  senalDeAprendizaje(peticion: PeticionSenalDeAprendizaje): Promise<void>;
  /**
   * Carga el cuerpo de una habilidad congelada, por su nombre. No pasa por el
   * gateway: es un paso interno del bucle (decisión 2 de la especificación).
   * Opcional porque solo hace falta cuando la versión tiene habilidades
   * congeladas; sin ellas, `cargar_habilidad` no aparece en el catálogo y esta
   * operación nunca se llama.
   */
  cargarHabilidad?:
    ((peticion: PeticionCargarHabilidad) => Promise<SalidaCargaHabilidad>) | undefined;
  /**
   * Aprendizaje v0: lanza el flujo que convierte la edición de esta aprobación en
   * señal y lección. Sin él, la edición se anota como señal genérica del bucle.
   */
  aprenderDeEdicion?: ((aprobacionId: string) => Promise<void>) | undefined;
  abrirDelegacion?: ((peticion: PeticionAbrirDelegacion) => Promise<DelegacionAbierta>) | undefined;
  /** Lanza el hijo y espera con el plazo del contrato. Devuelve nulo si venció. */
  esperarDelegacion?:
    | ((
        abierta: DelegacionAbierta,
        plazoSegundos: number,
      ) => Promise<ResultadoDelegacionHija | null>)
    | undefined;
  cerrarDelegacion?:
    ((delegacionId: string, resultado: Record<string, unknown>) => Promise<void>) | undefined;
  /**
   * Supervisor de departamento v0: cuenta un hecho de la delegación para que el
   * supervisor decida si avisa en la sala. Es un aviso: no devuelve nada, no cambia
   * la tarea y un fallo suyo no la hace fallar.
   */
  avisarSupervisor?: ((evento: EventoDeLaDelegacion) => Promise<void>) | undefined;
}

/** Hecho de una delegación que el bucle cuenta al supervisor. Eventos del ADR-014. */
export interface EventoDeLaDelegacion {
  tipo: 'delegacion.vencida' | 'delegacion.respaldo_aplicado' | 'delegacion.cerrada';
  delegacionId: string;
  politicaRespaldo?: PoliticaRespaldo | undefined;
  entregado?: boolean | undefined;
}

interface Cuenta {
  pasos: number;
  aprobaciones: number;
  ejecutadas: number;
  saltadas: number;
  simuladas: number;
}

/** Busca la herramienta en el catálogo. Un nombre inventado no está y se rechaza. */
function buscar(contexto: ContextoDeEjecucion, nombre: string): HerramientaDelCatalogo | undefined {
  return contexto.herramientas.find((herramienta) => herramienta.nombre === nombre);
}

/** Resumen legible de lo que se pide aprobar. Es lo que lee la persona en el correo. */
function resumirParaAprobar(
  herramienta: HerramientaDelCatalogo,
  argumentos: Record<string, unknown>,
): string {
  const partes = Object.entries(argumentos)
    .map(
      ([clave, valor]) => `${clave}: ${typeof valor === 'string' ? valor : JSON.stringify(valor)}`,
    )
    .join(' · ');
  return `${herramienta.descripcion || herramienta.nombre} — ${partes}`.slice(0, 900);
}

/**
 * Ejecuta el bucle completo de una tarea.
 *
 * Devuelve `esperando_aprobacion` cuando se detiene por presupuesto: no es un
 * fallo, es la conducta que el ADR-003 promete. La tarea queda con una aprobación
 * de ampliación pendiente y alguien decide si sigue.
 */
export async function ejecutarBucle(
  operaciones: OperacionesDelBucle,
  entrada: EntradaTareaAgente,
): Promise<ResultadoTareaAgente> {
  const maxPasos = entrada.maxPasos ?? MAX_PASOS_POR_DEFECTO;
  const validez = entrada.validezAprobacionSegundos ?? VALIDEZ_APROBACION_POR_DEFECTO;
  const identidad = {
    tenantId: entrada.tenantId,
    puestoId: entrada.puestoId,
    versionPuestoId: entrada.versionPuestoId,
    tareaId: entrada.tareaId,
  };

  const cuenta: Cuenta = { pasos: 0, aprobaciones: 0, ejecutadas: 0, saltadas: 0, simuladas: 0 };
  const mensajes: MensajeDeConversacion[] = [{ papel: 'usuario', texto: entrada.encargo }];
  let contexto = await operaciones.leerContexto();
  let gastado = contexto.gastadoEuros;
  let resumen = '';

  /** Número de paso global. Es la mitad de la clave de idempotencia. */
  let numeroPaso = 0;
  const siguientePaso = (): number => {
    numeroPaso += 1;
    return numeroPaso;
  };
  const clave = (paso: number, sufijo: string): string => `${entrada.tareaId}:${paso}:${sufijo}`;

  /** Detiene el bucle por presupuesto y abre la aprobación de ampliación. */
  async function detenerPorPresupuesto(motivo: string): Promise<ResultadoTareaAgente> {
    const paso = siguientePaso();
    const aprobacion = await operaciones.pedirAprobacion({
      ...identidad,
      guardiasSalida: contexto.guardiasSalida,
      claseAccion: CLASE_AMPLIACION,
      nivelExigido: 'n0',
      borradorOpaco: {
        tipo: CLASE_AMPLIACION,
        carga: {
          presupuestoEuros: contexto.presupuestoEuros,
          gastadoEuros: gastado,
          pasosDados: cuenta.pasos,
        },
      },
      resumenLegible:
        `La tarea ha gastado ${gastado.toFixed(4)} € de ${contexto.presupuestoEuros ?? 0} € ` +
        'y se ha detenido. ¿Amplías el presupuesto para que siga?',
      numeroPaso: paso,
      validezSegundos: validez,
    });
    cuenta.aprobaciones += 1;
    await operaciones.senalDeAprendizaje({
      ...identidad,
      tipo: 'metrica',
      resumen: 'La tarea se detuvo por presupuesto.',
      detalle: { gastadoEuros: gastado, limiteEuros: contexto.presupuestoEuros, motivo },
      puntuacion: -0.5,
    });
    return {
      estado: 'esperando_aprobacion',
      resumen:
        resumen ||
        'Tarea detenida al alcanzar el presupuesto, con una aprobación de ampliación pendiente.',
      pasos: cuenta.pasos,
      costeEuros: gastado,
      aprobacionesPedidas: cuenta.aprobaciones,
      escriturasEjecutadas: cuenta.ejecutadas,
      escriturasSaltadas: cuenta.saltadas,
      escriturasSimuladas: cuenta.simuladas,
      motivo: `${motivo} Aprobación de ampliación: ${aprobacion.aprobacionId}.`,
    };
  }

  for (let vuelta = 0; vuelta < maxPasos; vuelta += 1) {
    // Gancho de presupuesto antes de gastar. El paso de modelo cuesta dinero, así
    // que preguntar después de llamarlo sería preguntar tarde.
    const antes = evaluarPresupuesto({
      limiteEuros: contexto.presupuestoEuros,
      gastadoEuros: gastado,
    });
    if (antes.agotado) {
      return detenerPorPresupuesto('Presupuesto agotado antes de dar el siguiente paso.');
    }

    const pasoModelo = siguientePaso();
    const salida = await operaciones.pasoModelo({
      ...identidad,
      sistema: contexto.sistema,
      mensajes,
      herramientas: contexto.herramientas,
      numeroPaso: pasoModelo,
      guardiasSalida: contexto.guardiasSalida,
      claveIdempotencia: clave(pasoModelo, 'modelo'),
    });
    cuenta.pasos += 1;
    gastado = salida.gastadoEuros;
    resumen = salida.texto || resumen;
    mensajes.push({
      papel: 'agente',
      texto: salida.texto,
      ...(salida.llamadas.length > 0 ? { llamadas: salida.llamadas } : {}),
      ...(salida.bloques === undefined ? {} : { bloques: salida.bloques }),
    });

    if (salida.guardiaDisparada !== undefined) {
      // Un guardia que salta es una señal de aprendizaje, no solo un incidente: el
      // prompt de este puesto deja pasar algo que no debería.
      await operaciones.senalDeAprendizaje({
        ...identidad,
        tipo: 'incidencia',
        resumen: `El guardia de salida ${salida.guardiaDisparada} tapó parte de la respuesta.`,
        detalle: { guardia: salida.guardiaDisparada, paso: pasoModelo },
        puntuacion: -1,
      });
    }

    if (salida.llamadas.length === 0) break;

    for (const llamada of salida.llamadas) {
      const herramienta = buscar(contexto, llamada.herramienta);
      if (!herramienta) {
        // El modelo se inventó un nombre. No se llama a nadie y queda en el libro.
        const paso = siguientePaso();
        await operaciones.anotarPaso({
          ...identidad,
          guardiasSalida: contexto.guardiasSalida,
          numeroPaso: paso,
          tipo: 'herramienta_inventada',
          herramienta: llamada.herramienta,
          accion: 'herramienta.rechazada',
          resultado: 'rechazado',
          motivo: `La herramienta «${llamada.herramienta}» no está en el catálogo del puesto.`,
          entrada: { argumentos: llamada.argumentos },
        });
        mensajes.push({
          papel: 'herramienta',
          llamadaId: llamada.id,
          herramienta: llamada.herramienta,
          texto: `Error: la herramienta «${llamada.herramienta}» no existe para este puesto.`,
        });
        continue;
      }

      const veredicto = decidirPaso(
        { claseAccion: herramienta.claseAccion, tipo: herramienta.tipo },
        {
          estadoPuesto: contexto.estadoPuesto as Parameters<typeof decidirPaso>[1]['estadoPuesto'],
          politica: {
            niveles: contexto.nivelesPorClase,
            guardiasEntrada: contexto.guardiasEntrada,
            guardiasSalida: contexto.guardiasSalida,
            clasesProhibidas: contexto.clasesProhibidas,
            ...(contexto.presupuestoEuros === null
              ? {}
              : { presupuestoPorTareaEuros: contexto.presupuestoEuros }),
          },
          presupuesto: { limiteEuros: contexto.presupuestoEuros, gastadoEuros: gastado },
        },
      );

      if (veredicto.decision === 'detener') {
        return detenerPorPresupuesto(veredicto.motivo);
      }

      const textoDeHerramienta = await atenderVeredicto({
        veredicto,
        herramienta,
        llamada,
      });
      mensajes.push({
        papel: 'herramienta',
        llamadaId: llamada.id,
        herramienta: herramienta.nombre,
        texto: textoDeHerramienta,
      });
    }

    // El estado del puesto puede haber cambiado mientras el bucle corría: alguien
    // lo pausa o lo degrada, y el ADR-015 dice que los flujos lo consultan antes de
    // cada paso, no una vez al empezar.
    contexto = await operaciones.leerContexto();
    gastado = Math.max(gastado, contexto.gastadoEuros);
  }

  const delegada = await delegarSiToca();

  return {
    estado: 'completada',
    resumen: resumen || 'Tarea completada sin resumen del modelo.',
    pasos: cuenta.pasos,
    costeEuros: gastado,
    aprobacionesPedidas: cuenta.aprobaciones,
    escriturasEjecutadas: cuenta.ejecutadas,
    escriturasSaltadas: cuenta.saltadas,
    escriturasSimuladas: cuenta.simuladas,
    ...(delegada ? { delegacion: delegada } : {}),
  };

  /** Aplica el veredicto de la política y devuelve lo que se le cuenta al modelo. */
  async function atenderVeredicto(argumento: {
    veredicto: VeredictoPolitica;
    herramienta: HerramientaDelCatalogo;
    llamada: { id: string; herramienta: string; argumentos: Record<string, unknown> };
  }): Promise<string> {
    const { veredicto, herramienta, llamada } = argumento;

    if (veredicto.decision === 'rechazar') {
      const paso = siguientePaso();
      await operaciones.anotarPaso({
        ...identidad,
        guardiasSalida: contexto.guardiasSalida,
        numeroPaso: paso,
        tipo: 'herramienta_rechazada',
        herramienta: herramienta.nombre,
        accion: 'herramienta.rechazada',
        resultado: 'rechazado',
        nivelAplicado: veredicto.nivelAplicado,
        motivo: veredicto.motivo,
        entrada: { argumentos: llamada.argumentos },
      });
      if (herramienta.tipo === 'escritura') cuenta.saltadas += 1;
      return `Rechazado por política: ${veredicto.motivo}`;
    }

    if (veredicto.decision === 'simular') {
      const paso = siguientePaso();
      await operaciones.anotarPaso({
        ...identidad,
        guardiasSalida: contexto.guardiasSalida,
        numeroPaso: paso,
        tipo: 'herramienta_simulada',
        herramienta: herramienta.nombre,
        accion: 'herramienta.simulada',
        // `parcial` es lo que el modelo de datos reserva para una acción que se
        // intentó y no llegó a completarse. No hay resultado «simulado» y no se
        // inventa uno: el motivo lo dice la acción.
        resultado: 'parcial',
        nivelAplicado: veredicto.nivelAplicado,
        motivo: veredicto.motivo,
        entrada: { argumentos: llamada.argumentos },
      });
      cuenta.simuladas += 1;
      return `Simulado, no se ha escrito nada: ${veredicto.motivo}`;
    }

    let argumentos = llamada.argumentos;
    let aprobacionId: string | undefined;
    let nivel: Nivel | null = veredicto.nivelAplicado;

    if (veredicto.decision === 'pedir_aprobacion') {
      const pasoAprobacion = siguientePaso();
      const aprobacion = await operaciones.pedirAprobacion({
        ...identidad,
        guardiasSalida: contexto.guardiasSalida,
        claseAccion: herramienta.claseAccion,
        nivelExigido: veredicto.nivelAplicado ?? 'n0',
        borradorOpaco: {
          tipo: `herramienta.${herramienta.nombre}`,
          carga: { conector: herramienta.conector, argumentos: llamada.argumentos },
        },
        resumenLegible: resumirParaAprobar(herramienta, llamada.argumentos),
        numeroPaso: pasoAprobacion,
        validezSegundos: validez,
      });
      cuenta.aprobaciones += 1;
      aprobacionId = aprobacion.aprobacionId;

      const recibida = await operaciones.esperarDecision(aprobacion.aprobacionId, validez);
      // Una edición sin argumentos legibles no se ejecuta nunca con el borrador
      // original: la persona aprobó otra cosa. Se trata como rechazo, que es el lado
      // seguro, y queda el motivo en el paso.
      const decision: DecisionRecibida =
        recibida.sentido === 'editada' && recibida.argumentosEditados === undefined
          ? {
              ...recibida,
              sentido: 'rechazada',
              motivo:
                'La persona editó el borrador, pero la edición no se pudo leer: ' +
                'no se ejecuta el borrador original.',
            }
          : recibida;

      if (decision.sentido === 'rechazada') {
        const paso = siguientePaso();
        await operaciones.anotarPaso({
          ...identidad,
          guardiasSalida: contexto.guardiasSalida,
          numeroPaso: paso,
          tipo: 'herramienta_saltada',
          herramienta: herramienta.nombre,
          accion: 'herramienta.saltada',
          resultado: 'rechazado',
          nivelAplicado: nivel,
          motivo: decision.motivo ?? 'La persona rechazó la acción.',
          entrada: { argumentos: llamada.argumentos, aprobacionId: aprobacion.aprobacionId },
        });
        cuenta.saltadas += 1;
        await operaciones.senalDeAprendizaje({
          ...identidad,
          tipo: 'aprobacion',
          resumen: `Rechazada la llamada a ${herramienta.nombre}.`,
          detalle: { aprobacionId: aprobacion.aprobacionId, motivo: decision.motivo ?? null },
          puntuacion: -1,
        });
        return `La persona ha rechazado la acción: ${decision.motivo ?? 'sin motivo.'}`;
      }

      if (decision.sentido === 'editada') {
        // Lo que había antes de que la persona lo cambiara es la señal más valiosa
        // del aprendizaje: se ejecuta lo editado y se aprende de la diferencia.
        argumentos = decision.argumentosEditados ?? llamada.argumentos;
        if (operaciones.aprenderDeEdicion) {
          // Una sola señal por edición: la registra el flujo de aprendizaje, con la
          // diferencia saneada, y no el bucle con los argumentos en crudo.
          await operaciones.aprenderDeEdicion(aprobacion.aprobacionId);
        } else {
          await operaciones.senalDeAprendizaje({
            ...identidad,
            tipo: 'correccion',
            resumen: `La persona editó la llamada a ${herramienta.nombre} antes de aprobarla.`,
            detalle: { antes: llamada.argumentos, despues: argumentos },
            puntuacion: -0.3,
          });
        }
      } else {
        await operaciones.senalDeAprendizaje({
          ...identidad,
          tipo: 'aprobacion',
          resumen: `Aprobada sin cambios la llamada a ${herramienta.nombre}.`,
          detalle: { aprobacionId: aprobacion.aprobacionId },
          puntuacion: 1,
        });
      }

      if (!veredicto.ejecutaTrasAprobacion) {
        // N0 es manual: aprobar no significa que actúe el agente. Queda propuesto.
        const paso = siguientePaso();
        await operaciones.anotarPaso({
          ...identidad,
          guardiasSalida: contexto.guardiasSalida,
          numeroPaso: paso,
          tipo: 'herramienta_simulada',
          herramienta: herramienta.nombre,
          accion: 'herramienta.simulada',
          resultado: 'parcial',
          nivelAplicado: nivel,
          motivo: 'N0 es manual: la propuesta queda aprobada y la ejecuta la persona.',
          entrada: { argumentos, aprobacionId: aprobacion.aprobacionId },
        });
        cuenta.simuladas += 1;
        return 'Aprobado. Al ser N0, la acción la ejecuta la persona y no el agente.';
      }
      nivel = veredicto.nivelAplicado;
    }

    if (herramienta.nombre === NOMBRE_HERRAMIENTA_CARGAR_HABILIDAD) {
      // No pasa por el gateway: es un paso interno del bucle que solo lee lo ya
      // congelado en la versión (decisión 2 de la especificación). Si la actividad
      // no está montada —contexto sin habilidades, la herramienta ni aparecería—
      // se trata como si no se encontrara la habilidad, nunca como una llamada al
      // gateway.
      const pasoCarga = siguientePaso();
      const nombrePedido = String((argumentos as { nombre?: unknown })['nombre'] ?? '');
      const salida = operaciones.cargarHabilidad
        ? await operaciones.cargarHabilidad({
            ...identidad,
            nombre: nombrePedido,
            numeroPaso: pasoCarga,
            guardiasSalida: contexto.guardiasSalida,
          })
        : {
            encontrada: false,
            pasos: [],
            comprobaciones: [],
            motivo: 'No hay un cargador de habilidades montado en este proceso.',
          };
      if (!salida.encontrada) {
        return `No se cargó ninguna habilidad: ${salida.motivo}`;
      }
      return (
        `Pasos:\n${salida.pasos.map((paso) => `- ${paso}`).join('\n')}\n\n` +
        `Comprobaciones:\n${salida.comprobaciones.map((c) => `- ${c}`).join('\n')}`
      );
    }

    const pasoHerramienta = siguientePaso();
    const resultado = await operaciones.pasoHerramienta({
      ...identidad,
      herramienta: herramienta.nombre,
      argumentos,
      numeroPaso: pasoHerramienta,
      claveIdempotencia: clave(pasoHerramienta, herramienta.nombre),
      nivelAplicado: nivel,
      guardiasEntrada: contexto.guardiasEntrada,
      guardiasSalida: contexto.guardiasSalida,
      presupuestoEuros: contexto.presupuestoEuros,
      gastadoEuros: gastado,
      ...(aprobacionId === undefined ? {} : { aprobacionId }),
    });
    if (herramienta.tipo === 'escritura') cuenta.ejecutadas += 1;
    return resultado.texto;
  }

  /**
   * Abre la delegación, espera con el plazo del contrato y aplica el respaldo.
   *
   * El plazo lo cuenta el flujo padre con el reloj de Temporal, no con el del
   * proceso: si el trabajador se cae y otro lo reanuda, el plazo sigue siendo el
   * mismo. Vencido el plazo, la política de respaldo del ADR-014 decide, y lo que
   * decida queda registrado como hecho.
   */
  async function delegarSiToca(): Promise<ResultadoTareaAgente['delegacion']> {
    const peticion = entrada.delegacion;
    if (!peticion || !operaciones.abrirDelegacion || !operaciones.esperarDelegacion) {
      return undefined;
    }

    const abierta = await operaciones.abrirDelegacion({
      ...identidad,
      puestoDestinoNombre: peticion.puestoDestinoNombre,
      contrato: peticion.contrato,
    });
    const resultado = await operaciones.esperarDelegacion(abierta, peticion.contrato.plazoSegundos);

    if (resultado === null) {
      const respaldo = resolverRespaldo(peticion.contrato.politicaRespaldo);
      const paso = siguientePaso();
      await operaciones.anotarPaso({
        ...identidad,
        guardiasSalida: contexto.guardiasSalida,
        numeroPaso: paso,
        tipo: 'delegacion_vencida',
        accion: 'delegacion.vencida',
        resultado: 'error',
        motivo: respaldo.motivo,
        salida: {
          delegacionId: abierta.delegacionId,
          politicaRespaldo: peticion.contrato.politicaRespaldo,
        },
      });
      await operaciones.cerrarDelegacion?.(abierta.delegacionId, {
        entregado: false,
        motivo: respaldo.motivo,
        politicaRespaldo: peticion.contrato.politicaRespaldo,
      });
      // El plazo venció y el respaldo se aplicó en este mismo punto: son dos hechos
      // de la misma delegación y el supervisor publica un solo aviso por delegación.
      for (const tipo of ['delegacion.vencida', 'delegacion.respaldo_aplicado'] as const) {
        await operaciones.avisarSupervisor?.({
          tipo,
          delegacionId: abierta.delegacionId,
          politicaRespaldo: peticion.contrato.politicaRespaldo,
        });
      }
      return {
        tareaDestinoId: abierta.tareaDestinoId,
        entregado: false,
        resumen: respaldo.motivo,
        respaldoAplicado: peticion.contrato.politicaRespaldo,
      };
    }

    // El coste del hijo suma en la tarea raíz: una delegación no es una tarea más
    // que se cobre aparte (ADR-003), es consumo de la que la pidió.
    gastado += resultado.costeEuros;
    await operaciones.cerrarDelegacion?.(abierta.delegacionId, {
      entregado: resultado.entregado,
      resumen: resultado.resumen,
      costeEuros: resultado.costeEuros,
    });
    await operaciones.avisarSupervisor?.({
      tipo: 'delegacion.cerrada',
      delegacionId: abierta.delegacionId,
      entregado: resultado.entregado,
    });
    return {
      tareaDestinoId: resultado.tareaDestinoId,
      entregado: resultado.entregado,
      resumen: resultado.resumen,
    };
  }
}
