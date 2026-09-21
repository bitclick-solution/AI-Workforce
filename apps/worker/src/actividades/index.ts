/**
 * Actividades del trabajador: todo lo que tiene efectos.
 *
 * Cinco reglas que se repiten en todas y explican por qué están escritas así:
 *
 * 1. **Cada paso deja fila y entrada.** Se inserta en `paso` y se anota con
 *    `anotar`. La única `(tenant, tarea, numero)` de `paso` es la clave de
 *    idempotencia: reintentar la actividad no crea un paso nuevo.
 * 2. **Nada se cobra dos veces.** El uso de modelo lleva su clave de idempotencia y
 *    el contador la respeta; una herramienta ya ejecutada se reconoce por su fila de
 *    paso y no se vuelve a llamar.
 * 3. **La hora la pone la base.** Un flujo durable puede reanudarse en otra máquina
 *    y con otro reloj.
 * 4. **El coste sale de la base, no de la suma del bucle.** El bucle lleva su
 *    cuenta para decidir, pero el número que se cobra es el que cuadra con
 *    `uso_modelo`.
 * 5. **Ningún secreto sale de aquí.** El gateway resuelve las credenciales y los
 *    guardias de salida tapan lo que tenga forma de credencial antes de devolver
 *    texto al flujo, que es lo que acaba en el historial de Temporal.
 */
import { uuidV7 } from '@aiw/db';
import { contratoDelegacion, esquemas, type Nivel } from '@aiw/domain';
import {
  cargaDeSenal,
  leerAprobacion,
  registrarDecision,
  registrarTareaRaiz,
  registrarUsoDeModelo,
  solicitarAprobacion,
  anotar,
} from '@aiw/ledger';
import {
  componerPrompt,
  darPasoDeModelo,
  mensajesParaElModelo,
  type HerramientaOfrecida,
} from '@aiw/models';
import type postgres from 'postgres';

import { HerramientaFallo } from '@aiw/mcp-gateway';
import { ApplicationFailure } from '@temporalio/activity';

import { crearGuardias, revisarTodo } from '../bucle/guardias.js';
import type {
  AprobacionCreada,
  ContextoDeEjecucion,
  DecisionRecibida,
  DelegacionAbierta,
  PeticionAbrirDelegacion,
  PeticionAnotarPaso,
  PeticionDeAprobacion,
  PeticionPasoHerramienta,
  PeticionPasoModelo,
  PeticionProyectarEstado,
  PeticionSenalDeAprendizaje,
  SalidaPasoHerramienta,
  SalidaPasoModelo,
} from '../bucle/tipos.js';
import { enTenant, type ContextoDeActividades } from './contexto.js';

/** Acciones del libro que escriben estas actividades. Un solo sitio, se añaden. */
export const ACCIONES = {
  tareaArrancada: 'tarea.arrancada',
  tareaProyectada: 'tarea.proyectada',
  senalRegistrada: 'senal.registrada',
  delegacionAbierta: 'delegacion.abierta',
  delegacionCerrada: 'delegacion.cerrada',
} as const;

/** Herramienta del catálogo, con el mismo nombre de campos que usa el modelo. */
function comoOfrecida(herramienta: {
  nombre: string;
  descripcion: string;
  esquemaEntrada: unknown;
}): HerramientaOfrecida {
  return {
    nombre: herramienta.nombre,
    descripcion: herramienta.descripcion,
    esquemaEntrada: herramienta.esquemaEntrada,
  };
}

/**
 * Escribe la fila del paso, completa y una sola vez.
 *
 * `paso` es una fila inmutable: un disparador de la base rechaza cualquier
 * `UPDATE`, porque lo que afecta a la auditoría no se corrige en sitio (ADR-007).
 * Así que un paso no se «abre» y se «cierra»: se hace el trabajo y luego se
 * escribe lo que pasó, entero.
 *
 * La única `(tenant, tarea, numero)` es la clave de idempotencia. Un reintento
 * choca con ella, no inserta nada y devuelve la fila que ya estaba con lo que salió
 * la primera vez, que es exactamente lo que hace falta para no repetir un paso.
 */
interface PasoEscrito {
  pasoId: string;
  yaEstaba: boolean;
  salida: Record<string, unknown>;
  resultado: string;
  duracionMs: number;
}

async function escribirPaso(
  tx: postgres.TransactionSql,
  datos: {
    pasoId?: string | undefined;
    tenantId: string;
    tareaId: string;
    versionPuestoId: string;
    numero: number;
    tipo: string;
    herramienta?: string | null | undefined;
    entrada?: Record<string, unknown> | undefined;
    salida?: Record<string, unknown> | undefined;
    resultado: 'exito' | 'error' | 'rechazado' | 'parcial';
    costeEuros?: number | undefined;
    duracionMs?: number | undefined;
  },
): Promise<PasoEscrito> {
  const insertadas = await tx<{ id: string }[]>`
    insert into paso (
      id, tenant_id, tarea_id, version_puesto_id, numero, tipo, herramienta,
      entrada, salida, resultado, coste_euros, duracion_ms
    ) values (
      ${datos.pasoId ?? uuidV7()}, ${datos.tenantId}, ${datos.tareaId},
      ${datos.versionPuestoId}, ${datos.numero}, ${datos.tipo},
      ${datos.herramienta ?? null},
      ${JSON.stringify(datos.entrada ?? {})}::text::jsonb,
      ${JSON.stringify(datos.salida ?? {})}::text::jsonb,
      ${datos.resultado}, ${datos.costeEuros ?? 0},
      ${Math.round(datos.duracionMs ?? 0)}
    )
    on conflict (tenant_id, tarea_id, numero) do nothing
    returning id
  `;
  const nueva = insertadas[0];
  if (nueva) {
    return {
      pasoId: nueva.id,
      yaEstaba: false,
      salida: datos.salida ?? {},
      resultado: datos.resultado,
      duracionMs: datos.duracionMs ?? 0,
    };
  }

  const [previa] = await tx<
    { id: string; salida: Record<string, unknown>; resultado: string; duracion_ms: number }[]
  >`
    select id, salida, resultado, duracion_ms from paso
    where tenant_id = ${datos.tenantId} and tarea_id = ${datos.tareaId}
      and numero = ${datos.numero}
  `;
  if (!previa) throw new Error(`El paso ${datos.numero} no se insertó ni se encontró.`);
  return {
    pasoId: previa.id,
    yaEstaba: true,
    salida: previa.salida,
    resultado: previa.resultado,
    duracionMs: previa.duracion_ms,
  };
}

/** Coste acumulado de la tarea raíz, tal como lo dice `uso_modelo`. */
async function costeDeLaRaiz(
  tx: postgres.TransactionSql,
  tenantId: string,
  tareaId: string,
): Promise<number> {
  const [fila] = await tx<{ coste: string }[]>`
    select coalesce(sum(u.coste_euros), 0) as coste
    from uso_modelo u
    where u.tenant_id = ${tenantId}
      and u.tarea_raiz_id = (
        select coalesce(t.tarea_raiz_id, t.id) from tarea t
        where t.tenant_id = ${tenantId} and t.id = ${tareaId}
      )
  `;
  return Number(fila?.coste ?? 0);
}

/**
 * Llama a la herramienta y traduce el fallo a lo que Temporal entiende.
 *
 * El contrato de los conectores dice que solo `temporal` mejora al insistir. Los
 * otros tres motivos —no encontrada, no autorizado, argumentos inválidos— no van a
 * cambiar en treinta segundos, así que se marcan como no reintentables y la tarea
 * falla ya con el motivo en la mano. Reintentar cuatro veces un `no_encontrada` es
 * hacer esperar al cliente medio minuto para acabar igual.
 *
 * Un fallo que no cumple el contrato sí se reintenta: lo más probable es que sea del
 * transporte, y esos pasan.
 */
async function llamarConReintentoGobernado(
  contexto: ContextoDeActividades,
  pasoId: string,
  peticion: PeticionPasoHerramienta,
) {
  try {
    return await contexto.gateway.llamar(
      {
        tenantId: peticion.tenantId,
        puestoId: peticion.puestoId,
        versionPuestoId: peticion.versionPuestoId,
        tareaId: peticion.tareaId,
        pasoId,
      },
      {
        herramienta: peticion.herramienta,
        argumentos: peticion.argumentos,
        presupuesto: {
          limiteEuros: peticion.presupuestoEuros,
          gastadoEuros: peticion.gastadoEuros,
        },
        ...(peticion.aprobacionId === undefined ? {} : { aprobacionId: peticion.aprobacionId }),
      },
    );
  } catch (error) {
    if (error instanceof HerramientaFallo && !error.reintentable) {
      throw ApplicationFailure.create({
        message: error.message,
        type: error.codigo ?? 'HerramientaFallo',
        nonRetryable: true,
        details: [{ herramienta: error.herramienta, motivo: error.motivo }],
      });
    }
    throw error;
  }
}

/**
 * Construye todas las actividades sobre un contexto.
 *
 * Se devuelven como objeto y no como funciones exportadas porque necesitan la
 * conexión y el gateway, y una actividad que abre su propia conexión abriría una
 * por reintento.
 */
export function crearActividades(contexto: ContextoDeActividades) {
  return {
    /**
     * Arranca la tarea: la cuenta como unidad de consumo y la deja en curso.
     *
     * Contar es idempotente y lo garantiza el libro: `registrarTareaRaiz` busca su
     * propia entrada antes de sumar, así que reintentar esta actividad o ejecutarla
     * en dos trabajadores deja una unidad.
     */
    async arrancarTarea(peticion: {
      tenantId: string;
      tareaId: string;
      puestoId: string;
      versionPuestoId: string;
      flujoTemporalId: string;
      ejecucionTemporalId: string;
    }): Promise<{ conto: boolean }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        await tx`
          update tarea set
            estado = 'en_curso',
            flujo_temporal_id = ${peticion.flujoTemporalId},
            ejecucion_temporal_id = ${peticion.ejecucionTemporalId},
            proyectado_en = clock_timestamp()
          where tenant_id = ${peticion.tenantId} and id = ${peticion.tareaId}
        `;
        const contada = await registrarTareaRaiz(tx, peticion.tenantId, {
          tareaId: peticion.tareaId,
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
        });
        return { conto: contada.conto };
      });
    },

    /**
     * Lee todo lo que el bucle necesita para decidir: catálogo, niveles, estado del
     * puesto, política, prompt compuesto y lo gastado.
     *
     * Se llama al empezar y después de cada vuelta. El ADR-015 lo pide así: los
     * flujos consultan el estado del puesto antes de cada paso, porque pausar o
     * degradar un agente tiene que surtir efecto en la tarea que ya está corriendo.
     */
    async leerContexto(peticion: {
      tenantId: string;
      puestoId: string;
      versionPuestoId: string;
      tareaId: string;
    }): Promise<ContextoDeEjecucion> {
      const catalogo = await contexto.gateway.herramientasPara(peticion);

      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [fila] = await tx<
          {
            prompt: string;
            politica: unknown;
            brand_voice: unknown;
            presupuesto_euros: string;
          }[]
        >`
          select v.prompt, v.politica, o.brand_voice, t.presupuesto_euros
          from version_puesto v
          join tarea t on t.tenant_id = v.tenant_id and t.id = ${peticion.tareaId}
          join organizacion o on o.id = v.tenant_id
          where v.tenant_id = ${peticion.tenantId} and v.id = ${peticion.versionPuestoId}
        `;
        if (!fila) {
          throw new Error(
            `No hay versión ${peticion.versionPuestoId} con tarea ${peticion.tareaId}: ` +
              'sin política congelada el bucle no puede decidir nada.',
          );
        }

        const politica = esquemas.validarCarga(
          esquemas.politicaPuesto,
          fila.politica,
          'version_puesto.politica',
        );
        const voz = esquemas.validarCarga(
          esquemas.brandVoice,
          fila.brand_voice,
          'organizacion.brand_voice',
        );

        const sistema = contexto.cachePrompts.obtener(peticion.versionPuestoId, () =>
          componerPrompt({ prompt: fila.prompt, brandVoice: voz }),
        );
        const limite = Number(fila.presupuesto_euros);

        return {
          estadoPuesto: catalogo.estadoPuesto,
          sistema,
          herramientas: catalogo.herramientas.map((herramienta) => ({ ...herramienta })),
          nivelesPorClase: { ...catalogo.nivelesPorClase },
          clasesProhibidas: [...politica.clasesProhibidas],
          guardiasEntrada: [...politica.guardiasEntrada],
          guardiasSalida: [...politica.guardiasSalida],
          // Un presupuesto sin declarar es cero en la columna, y cero significa que
          // esta tarea no gasta. Nulo se reserva para «no hay límite», que en esta
          // rebanada solo ocurre si alguien lo pide explícitamente.
          presupuestoEuros: Number.isFinite(limite) ? limite : null,
          gastadoEuros: await costeDeLaRaiz(tx, peticion.tenantId, peticion.tareaId),
        };
      });
    },

    /**
     * Un paso de modelo: llama, cobra el uso, sanea la salida y anota.
     *
     * El cobro va por `registrarUsoDeModelo` con la clave del paso, así que un
     * reintento de Temporal no vuelve a cobrar. Los guardias de salida se aplican
     * aquí y no en el flujo porque lo que devuelve esta actividad entra en el
     * historial de Temporal, y del historial ya no se borra nada.
     */
    async pasoModelo(peticion: PeticionPasoModelo): Promise<SalidaPasoModelo> {
      const [puesto] = await enTenant(
        contexto,
        peticion.tenantId,
        (tx) => tx<{ enrutado_modelo: unknown }[]>`
        select enrutado_modelo from puesto
        where tenant_id = ${peticion.tenantId} and id = ${peticion.puestoId}
      `,
      );
      const { modelo, proveedor, modeloId } = contexto.enrutador.resolver(
        puesto?.enrutado_modelo ?? {},
      );

      const paso = await darPasoDeModelo({
        modelo,
        sistema: peticion.sistema,
        mensajes: mensajesParaElModelo(peticion.mensajes),
        herramientas: peticion.herramientas.map(comoOfrecida),
        atributos: {
          tenantId: peticion.tenantId,
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
          tareaId: peticion.tareaId,
          proveedor,
          modelo: modeloId,
        },
        trazas: contexto.trazas,
        nombreTraza: 'agente.paso_modelo',
      });

      const guardias = crearGuardias(peticion.guardiasSalida);
      const revisado = revisarTodo(guardias, paso.texto);

      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const escrito = await escribirPaso(tx, {
          tenantId: peticion.tenantId,
          tareaId: peticion.tareaId,
          versionPuestoId: peticion.versionPuestoId,
          numero: peticion.numeroPaso,
          tipo: 'modelo',
          herramienta: proveedor,
          entrada: { herramientasOfrecidas: peticion.herramientas.length },
          salida: {
            motivoFin: paso.motivoFin,
            llamadas: paso.llamadas.map((llamada) => llamada.herramienta),
            ...(revisado.pasa ? {} : { guardias: revisado.hallazgos }),
          },
          resultado: revisado.pasa ? 'exito' : 'parcial',
          costeEuros: 0,
          duracionMs: paso.duracionMs,
        });

        // El coste del paso lo pone el contador con la tarifa vigente, y la clave
        // de idempotencia es lo que impide cobrarlo dos veces si la actividad se
        // reintenta. `paso.coste_euros` queda en cero porque la fila es inmutable y
        // el coste de verdad vive en `uso_modelo`, que es donde cuadra el contador.
        const uso = await registrarUsoDeModelo(tx, peticion.tenantId, {
          tareaId: peticion.tareaId,
          pasoId: escrito.pasoId,
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
          proveedor,
          modelo: modeloId,
          tokens: paso.tokens,
          claveIdempotencia: peticion.claveIdempotencia,
        });

        return {
          texto: revisado.texto,
          llamadas: paso.llamadas.map((llamada) => ({
            id: llamada.id,
            herramienta: llamada.herramienta,
            argumentos: llamada.argumentos,
          })),
          costeEuros: uso.costeEuros,
          gastadoEuros: await costeDeLaRaiz(tx, peticion.tenantId, peticion.tareaId),
          motivoFin: paso.motivoFin,
          ...(revisado.pasa
            ? {}
            : { guardiaDisparada: revisado.hallazgos[0]?.guardia ?? 'sin_secretos' }),
        };
      });
    },

    /**
     * Un paso de herramienta por el gateway.
     *
     * Antes de llamar mira si ese número de paso ya tiene fila con éxito. Si la
     * tiene, la llamada ya se hizo y se devuelve lo que salió: eso es lo que pide el
     * criterio 2 —«el flujo continúa desde el historial sin repetir ninguna llamada
     * ya ejecutada»— y la garantía la da la base, no Temporal.
     *
     * Queda una ventana: si el proceso muere entre la llamada al conector y la
     * escritura de la fila, un reintento vuelve a llamar. No se puede cerrar sin que
     * el conector acepte claves de idempotencia, así que se deja escrito en vez de
     * fingir que no existe. Para eso el identificador del paso se genera aquí y va
     * en la entrada de auditoría: si se repite, se ve en el libro.
     */
    async pasoHerramienta(peticion: PeticionPasoHerramienta): Promise<SalidaPasoHerramienta> {
      const [previo] = await enTenant(
        contexto,
        peticion.tenantId,
        (tx) => tx<{ salida: { texto?: string } | null; duracion_ms: number }[]>`
        select salida, duracion_ms from paso
        where tenant_id = ${peticion.tenantId} and tarea_id = ${peticion.tareaId}
          and numero = ${peticion.numeroPaso} and resultado = 'exito'
      `,
      );
      if (previo) {
        return {
          texto: previo.salida?.texto ?? '',
          duracionMs: previo.duracion_ms,
          yaEstaba: true,
        };
      }

      const pasoId = uuidV7();
      const llamada = await llamarConReintentoGobernado(contexto, pasoId, peticion);

      // El resultado de la herramienta vuelve al modelo en la siguiente vuelta: pasa
      // por los guardias antes de entrar en el historial.
      const guardias = crearGuardias(peticion.guardiasEntrada);
      const revisado = revisarTodo(guardias, llamada.texto);

      const escrito = await enTenant(contexto, peticion.tenantId, (tx) =>
        escribirPaso(tx, {
          pasoId,
          tenantId: peticion.tenantId,
          tareaId: peticion.tareaId,
          versionPuestoId: peticion.versionPuestoId,
          numero: peticion.numeroPaso,
          tipo: 'herramienta',
          herramienta: peticion.herramienta,
          entrada: { argumentos: peticion.argumentos },
          salida: { texto: revisado.texto, conector: llamada.conector },
          resultado: 'exito',
          duracionMs: llamada.duracionMs,
        }),
      );

      return {
        texto: revisado.texto,
        duracionMs: llamada.duracionMs,
        yaEstaba: escrito.yaEstaba,
      };
    },

    /**
     * Pide permiso: crea la aprobación con borrador opaco y resumen legible.
     *
     * La idempotencia la da la fila del paso: el número de paso es único por tarea,
     * así que un reintento encuentra el paso y su aprobación en vez de pedir permiso
     * dos veces por lo mismo. Nada peor que un correo duplicado para perder la
     * confianza de quien aprueba.
     *
     * Aquí el paso se escribe antes que la aprobación, y no después como en los
     * demás: `aprobacion.paso_id` tiene clave foránea a `paso`, así que el paso
     * tiene que existir. Su `salida` queda vacía —la fila es inmutable y no se puede
     * rellenar luego—, y el registro de lo que se pidió vive en la propia fila de
     * `aprobacion` y en la entrada del libro.
     */
    async pedirAprobacion(peticion: PeticionDeAprobacion): Promise<AprobacionCreada> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const { pasoId } = await escribirPaso(tx, {
          tenantId: peticion.tenantId,
          tareaId: peticion.tareaId,
          versionPuestoId: peticion.versionPuestoId,
          numero: peticion.numeroPaso,
          tipo: 'aprobacion',
          entrada: { claseAccion: peticion.claseAccion, nivel: peticion.nivelExigido },
          resultado: 'parcial',
        });

        const [previa] = await tx<{ id: string }[]>`
          select id from aprobacion
          where tenant_id = ${peticion.tenantId} and paso_id = ${pasoId}
        `;
        if (previa) return { aprobacionId: previa.id, yaEstaba: true };

        const [persona] = await tx<{ id: string }[]>`
          select p.id from persona p
          join departamento d on d.tenant_id = p.tenant_id and d.supervisor_persona_id = p.id
          join puesto pu on pu.tenant_id = d.tenant_id and pu.departamento_id = d.id
          where p.tenant_id = ${peticion.tenantId} and pu.id = ${peticion.puestoId}
          limit 1
        `;

        const solicitada = await solicitarAprobacion(tx, peticion.tenantId, {
          tareaId: peticion.tareaId,
          pasoId,
          personaId: persona?.id ?? null,
          claseAccion: peticion.claseAccion,
          nivelExigido: peticion.nivelExigido,
          borradorOpaco: peticion.borradorOpaco,
          resumenLegible: peticion.resumenLegible,
          venceEn: new Date(Date.now() + peticion.validezSegundos * 1000),
        });
        return { aprobacionId: solicitada.id, yaEstaba: false };
      });
    },

    /**
     * Lee la decisión de una aprobación, si ya la hay.
     *
     * El flujo la llama antes de esperar la señal. Si el trabajador se cayó justo
     * después de que alguien pulsara el enlace, la señal se perdió pero la decisión
     * está en la base: el flujo la recupera y no espera a nadie.
     */
    async leerDecision(peticion: {
      tenantId: string;
      aprobacionId: string;
    }): Promise<DecisionRecibida | null> {
      const leida = await enTenant(contexto, peticion.tenantId, (tx) =>
        leerAprobacion(tx, peticion.tenantId, peticion.aprobacionId),
      );
      if (!leida?.decision) return null;
      return {
        aprobacionId: leida.id,
        sentido: leida.decision.sentido,
        personaId: leida.decision.personaId,
      };
    },

    /**
     * Vence una aprobación que nadie contestó.
     *
     * La resuelve la plataforma con `persona_id` nulo, que es lo que el modelo de
     * datos reserva para eso (ADR-005). Sin esto, un flujo que espera una aprobación
     * que nadie abrió espera para siempre.
     */
    async vencerAprobacion(peticion: {
      tenantId: string;
      aprobacionId: string;
      motivo: string;
    }): Promise<DecisionRecibida> {
      const resultado = await registrarDecision(contexto.cliente, peticion.tenantId, {
        aprobacionId: peticion.aprobacionId,
        sentido: 'rechazada',
        personaId: null,
        motivo: peticion.motivo,
        origen: 'plataforma',
        herramienta: 'temporal',
      });
      if (resultado.estado === 'registrada') {
        return {
          aprobacionId: peticion.aprobacionId,
          sentido: 'rechazada',
          personaId: null,
          motivo: peticion.motivo,
        };
      }
      // Alguien decidió mientras vencía. Gana la persona.
      const previa = resultado.decisionPrevia;
      return {
        aprobacionId: peticion.aprobacionId,
        sentido: previa?.sentido ?? 'rechazada',
        personaId: previa?.personaId ?? null,
      };
    },

    /** Anota un paso que no llama a nadie: un rechazo, una simulación, un salto. */
    async anotarPaso(peticion: PeticionAnotarPaso): Promise<void> {
      await enTenant(contexto, peticion.tenantId, async (tx) => {
        const { pasoId } = await escribirPaso(tx, {
          tenantId: peticion.tenantId,
          tareaId: peticion.tareaId,
          versionPuestoId: peticion.versionPuestoId,
          numero: peticion.numeroPaso,
          tipo: peticion.tipo,
          herramienta: peticion.herramienta ?? null,
          entrada: peticion.entrada,
          salida: { motivo: peticion.motivo, ...(peticion.salida ?? {}) },
          resultado: peticion.resultado,
          duracionMs: peticion.duracionMs,
        });
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'agente',
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
          tareaId: peticion.tareaId,
          pasoId,
          accion: peticion.accion,
          herramienta: peticion.herramienta ?? null,
          datosReferenciados: [{ tipo: 'motivo', id: peticion.motivo.slice(0, 200) }],
          resultado: peticion.resultado,
          ...(peticion.nivelAplicado ? { nivelAplicado: peticion.nivelAplicado } : {}),
          ...(peticion.duracionMs === undefined ? {} : { duracionMs: peticion.duracionMs }),
        });
      });
    },

    /**
     * Deja una señal de aprendizaje.
     *
     * El bucle observa y guarda; promocionar una lección es otra rebanada y otra
     * decisión. Lo que importa aquí es que la señal exista y esté atada a la versión
     * de puesto que la produjo: sin eso, el aprendizaje no tiene de dónde aprender.
     */
    async senalDeAprendizaje(peticion: PeticionSenalDeAprendizaje): Promise<void> {
      await enTenant(contexto, peticion.tenantId, async (tx) => {
        const contenido = esquemas.validarCarga(
          esquemas.contenidoSenal,
          {
            resumen: peticion.resumen,
            detalle: peticion.detalle,
            ...(peticion.puntuacion === undefined ? {} : { puntuacion: peticion.puntuacion }),
          },
          'senal.contenido',
        );
        const [fila] = await tx<{ id: string }[]>`
          insert into senal (tenant_id, puesto_id, tipo, origen, tarea_id, contenido)
          values (
            ${peticion.tenantId}, ${peticion.puestoId}, ${peticion.tipo}, 'bucle',
            ${peticion.tareaId}, ${JSON.stringify(contenido)}::text::jsonb
          )
          returning id
        `;
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'plataforma',
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
          tareaId: peticion.tareaId,
          accion: ACCIONES.senalRegistrada,
          datosReferenciados: [
            { tipo: 'senal', id: fila?.id ?? 'sin-id' },
            { tipo: 'tipo_senal', id: peticion.tipo },
          ],
          resultado: 'exito',
        });
      });
    },

    /**
     * Proyecta el estado de la tarea.
     *
     * Es una proyección y no la verdad: la verdad es el historial de Temporal. Si
     * esta fila se pierde o se corrompe, se vuelve a escribir repitiendo el flujo.
     * Por eso el panel lee de aquí y las decisiones se toman allí.
     */
    async proyectarEstado(peticion: PeticionProyectarEstado): Promise<void> {
      await enTenant(contexto, peticion.tenantId, async (tx) => {
        await tx`
          update tarea set
            estado = ${peticion.estado},
            resultado = ${JSON.stringify(peticion.resultado ?? {})}::text::jsonb,
            coste_euros = ${await costeDeLaRaiz(tx, peticion.tenantId, peticion.tareaId)},
            proyectado_en = clock_timestamp()
          where tenant_id = ${peticion.tenantId} and id = ${peticion.tareaId}
        `;
      });
    },

    /**
     * Abre la delegación: crea la tarea del hijo y la fila del contrato.
     *
     * La tarea del hijo cuelga de la raíz del padre, así que su consumo suma ahí y
     * no cuenta como tarea nueva (ADR-003). `delegacion.tarea_destino_id` queda
     * enlazado desde el principio, que es lo que permite seguir el rastro sin
     * esperar a que el hijo termine.
     */
    async abrirDelegacion(peticion: PeticionAbrirDelegacion): Promise<DelegacionAbierta> {
      // Segunda cerradura de la misma puerta: el flujo ya validó el contrato al
      // entrar, y aquí se vuelve a validar porque esta actividad escribe en el libro
      // y una carga que el libro rechaza no mejora por reintentarla. Falla no
      // reintentable, así que el flujo lo ve en el primer intento.
      const contrato = contratoDelegacion.safeParse(peticion.contrato);
      if (!contrato.success) {
        throw ApplicationFailure.create({
          message:
            'El contrato de la delegación no cumple el ADR-014: ' +
            contrato.error.issues
              .map((problema) => `${problema.path.join('.') || '(raíz)'}: ${problema.message}`)
              .join('; '),
          type: 'ContratoDeDelegacionNoValido',
          nonRetryable: true,
        });
      }

      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [destino] = await tx<
          { id: string; version_activa_id: string | null; departamento_id: string }[]
        >`
          select id, version_activa_id, departamento_id from puesto
          where tenant_id = ${peticion.tenantId} and nombre = ${peticion.puestoDestinoNombre}
        `;
        if (!destino?.version_activa_id) {
          throw new Error(
            `El puesto «${peticion.puestoDestinoNombre}» no existe o no tiene versión activa: ` +
              'no se delega a un puesto sin prompt ni política.',
          );
        }

        const [previa] = await tx<
          { id: string; tarea_destino_id: string | null; plazo: Date | null }[]
        >`
          select id, tarea_destino_id, plazo from delegacion
          where tenant_id = ${peticion.tenantId}
            and tarea_origen_id = ${peticion.tareaId}
            and puesto_destino_id = ${destino.id}
        `;
        if (previa?.tarea_destino_id) {
          const [versionPrevia] = await tx<{ version_puesto_id: string }[]>`
            select version_puesto_id from tarea
            where tenant_id = ${peticion.tenantId} and id = ${previa.tarea_destino_id}
          `;
          return {
            delegacionId: previa.id,
            tareaDestinoId: previa.tarea_destino_id,
            puestoDestinoId: destino.id,
            versionPuestoDestinoId: versionPrevia?.version_puesto_id ?? destino.version_activa_id,
            plazo: (previa.plazo ?? new Date()).toISOString(),
            yaEstaba: true,
          };
        }

        const [raiz] = await tx<{ raiz: string; departamento: string }[]>`
          select coalesce(t.tarea_raiz_id, t.id) as raiz, p.departamento_id as departamento
          from tarea t
          join puesto p on p.tenant_id = t.tenant_id and p.id = t.puesto_id
          where t.tenant_id = ${peticion.tenantId} and t.id = ${peticion.tareaId}
        `;
        if (!raiz) throw new Error(`La tarea ${peticion.tareaId} no existe en este tenant.`);

        const [hija] = await tx<{ id: string }[]>`
          insert into tarea (
            tenant_id, tarea_raiz_id, tarea_padre_id, puesto_id, version_puesto_id,
            origen, estado, presupuesto_euros
          ) values (
            ${peticion.tenantId}, ${raiz.raiz}, ${peticion.tareaId}, ${destino.id},
            ${destino.version_activa_id}, 'delegacion', 'pendiente',
            ${peticion.contrato.presupuestoEuros}
          )
          returning id
        `;
        if (!hija) throw new Error('La tarea de la delegación no se insertó.');

        const formato = esquemas.validarCarga(
          esquemas.formatoDelegacion,
          peticion.contrato.formato,
          'delegacion.formato',
        );

        const [creada] = await tx<{ id: string; plazo: Date }[]>`
          insert into delegacion (
            tenant_id, tarea_origen_id, tarea_destino_id, puesto_origen_id,
            puesto_destino_id, encargo, plazo, presupuesto_euros, formato,
            cruza_departamento
          ) values (
            ${peticion.tenantId}, ${peticion.tareaId}, ${hija.id}, ${peticion.puestoId},
            ${destino.id}, ${peticion.contrato.encargo},
            clock_timestamp() + make_interval(secs => ${peticion.contrato.plazoSegundos}),
            ${peticion.contrato.presupuestoEuros},
            ${JSON.stringify(formato)}::text::jsonb,
            ${raiz.departamento !== destino.departamento_id}
          )
          returning id, plazo
        `;
        if (!creada) throw new Error('La delegación no se insertó.');

        await anotar(tx, peticion.tenantId, {
          actorTipo: 'agente',
          puestoId: peticion.puestoId,
          versionPuestoId: peticion.versionPuestoId,
          tareaId: peticion.tareaId,
          accion: ACCIONES.delegacionAbierta,
          datosReferenciados: [
            { tipo: 'delegacion', id: creada.id },
            { tipo: 'tarea', id: hija.id },
            { tipo: 'puesto', id: destino.id },
            { tipo: 'politica_respaldo', id: peticion.contrato.politicaRespaldo },
          ],
          resultado: 'exito',
        });

        return {
          delegacionId: creada.id,
          tareaDestinoId: hija.id,
          puestoDestinoId: destino.id,
          versionPuestoDestinoId: destino.version_activa_id,
          plazo: creada.plazo.toISOString(),
          yaEstaba: false,
        };
      });
    },

    /** Cierra la delegación con lo que devolvió el hijo, o con el respaldo aplicado. */
    async cerrarDelegacion(peticion: {
      tenantId: string;
      delegacionId: string;
      resultado: Record<string, unknown>;
    }): Promise<void> {
      await enTenant(contexto, peticion.tenantId, async (tx) => {
        const [fila] = await tx<
          { tarea_origen_id: string; puesto_origen_id: string; tarea_destino_id: string | null }[]
        >`
          update delegacion set
            resultado = ${JSON.stringify(peticion.resultado)}::text::jsonb
          where tenant_id = ${peticion.tenantId} and id = ${peticion.delegacionId}
          returning tarea_origen_id, puesto_origen_id, tarea_destino_id
        `;
        if (!fila) return;
        const [version] = await tx<{ version_puesto_id: string }[]>`
          select version_puesto_id from tarea
          where tenant_id = ${peticion.tenantId} and id = ${fila.tarea_origen_id}
        `;
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'agente',
          puestoId: fila.puesto_origen_id,
          versionPuestoId: version?.version_puesto_id ?? null,
          tareaId: fila.tarea_origen_id,
          accion: ACCIONES.delegacionCerrada,
          datosReferenciados: [
            { tipo: 'delegacion', id: peticion.delegacionId },
            ...(fila.tarea_destino_id ? [{ tipo: 'tarea', id: fila.tarea_destino_id }] : []),
          ],
          resultado: peticion.resultado['entregado'] === true ? 'exito' : 'parcial',
        });
      });
    },

    /** Compone la carga de la señal de decisión. La usa el mandato `decidir`. */
    async cargaDeDecision(peticion: {
      tenantId: string;
      aprobacionId: string;
    }): Promise<{ flujoId: string | null; carga: unknown } | null> {
      const leida = await enTenant(contexto, peticion.tenantId, (tx) =>
        leerAprobacion(tx, peticion.tenantId, peticion.aprobacionId),
      );
      if (!leida?.decision) return null;
      return {
        flujoId: leida.flujoTemporalId,
        carga: cargaDeSenal(peticion.tenantId, leida, leida.decision, 'plataforma'),
      };
    },
  };
}

export type Actividades = ReturnType<typeof crearActividades>;

/** Nivel tal como lo espera el libro. Se exporta para las pruebas del bucle. */
export type NivelDelLibro = Nivel;
