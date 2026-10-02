/**
 * Actividades de la sala v0: publicar, moderar, intervenir, proponer y contratar.
 *
 * Toda escritura de la sala pasa por aquí, dentro de una transacción con el tenant
 * fijado y con su entrada en el libro en la misma transacción: o queda el mensaje y
 * su anotación, o no queda ninguno. La API solo arranca y señala flujos.
 *
 * Cada actividad es idempotente por el identificador que le pasa el flujo. Temporal
 * la reintenta tras una caída y el reintento encuentra lo que ya hizo en vez de
 * duplicarlo; es la misma disciplina que `arrancarTarea` con el contador.
 */
import { uuidV7 } from '@aiw/db';
import { anotar } from '@aiw/ledger';
import { proponerContratacionConModelo, type PropuestaDeContratacion } from '@aiw/platform-agents';
import {
  moderarConModelo,
  type AdjuntoDeSala,
  type DecisionDelModerador,
  type ParticipanteDeSala,
} from '@aiw/rooms';
import { ApplicationFailure } from '@temporalio/activity';
import type postgres from 'postgres';

import { MODELO_PRUEBA_DIRECTOR, MODELO_PRUEBA_MODERADOR } from '@aiw/models';
import { crearClasificadorDeSala } from './clasificacion.js';
import { enTenant, type ContextoDeActividades } from './contexto.js';

/** Nombres de acción del libro. Dominio y acción en pasado (ADR-014). */
export const ACCIONES_SALA = {
  mensajePublicado: 'sala.mensaje_publicado',
  moderacionDecidida: 'sala.moderacion_decidida',
  intervencionAbierta: 'sala.intervencion_abierta',
  respuestaPublicada: 'sala.respuesta_publicada',
  propuestaCreada: 'propuesta.creada',
  propuestaAprobada: 'propuesta.aprobada',
  propuestaRechazada: 'propuesta.rechazada',
  propuestaCaducada: 'propuesta.caducada',
  puestoContratado: 'puesto.contratado',
  // Sala v1: salas por equipo y presencia en vivo (ADR-022).
  miembroAnadido: 'sala.miembro_anadido',
  miembroQuitado: 'sala.miembro_quitado',
} as const;

const SEGUNDOS_POR_DIA = 24 * 60 * 60;

/** Un error de datos no mejora por reintentar: se marca como no reintentable. */
function errorDeDatos(mensaje: string): ApplicationFailure {
  return ApplicationFailure.create({ message: mensaje, type: 'DatosDeSala', nonRetryable: true });
}

interface MensajeNuevo {
  id: string;
  salaId: string;
  cuerpo: string;
  autorPersonaId?: string | null | undefined;
  autorPuestoId?: string | null | undefined;
  adjuntos?: AdjuntoDeSala[] | undefined;
}

/**
 * Inserta un mensaje si no existe. `mensaje` está particionada y su clave incluye
 * `creado_en`, así que un `on conflict` no serviría: el reintento traería otra hora.
 * Se busca por identificador dentro de la misma transacción.
 *
 * Sala v1: si es de verdad nuevo, avisa a Centrifugo sin esperar (`void`) y sin
 * que un fallo suyo afecte a la transacción. La publicación es solo un aviso de
 * «algo cambió, vuelve a leer» (`{ tipo: 'mensaje' }`), no el mensaje en sí: un
 * aviso que llegara antes de que la transacción confirme, y que luego no
 * confirmara, deja como mucho una relectura de balde, nunca un dato inventado.
 */
async function insertarMensaje(
  contexto: ContextoDeActividades,
  tx: postgres.TransactionSql,
  tenantId: string,
  mensaje: MensajeNuevo,
): Promise<{ creadoEn: Date; yaEstaba: boolean }> {
  const [previo] = await tx<{ creado_en: Date }[]>`
    select creado_en from mensaje where tenant_id = ${tenantId} and id = ${mensaje.id}
  `;
  if (previo) return { creadoEn: previo.creado_en, yaEstaba: true };
  const [nuevo] = await tx<{ creado_en: Date }[]>`
    insert into mensaje (id, tenant_id, sala_id, autor_persona_id, autor_puesto_id, cuerpo, adjuntos)
    values (
      ${mensaje.id}, ${tenantId}, ${mensaje.salaId}, ${mensaje.autorPersonaId ?? null},
      ${mensaje.autorPuestoId ?? null}, ${mensaje.cuerpo},
      ${JSON.stringify(mensaje.adjuntos ?? [])}::text::jsonb
    )
    returning creado_en
  `;
  if (!nuevo) throw new Error('El mensaje no se insertó.');
  void contexto.avisarSala(tenantId, mensaje.salaId, { tipo: 'mensaje' });
  return { creadoEn: nuevo.creado_en, yaEstaba: false };
}

async function exigirPersonaActiva(
  tx: postgres.TransactionSql,
  tenantId: string,
  personaId: string,
): Promise<void> {
  const [persona] = await tx<{ activa: boolean }[]>`
    select activa from persona where tenant_id = ${tenantId} and id = ${personaId}
  `;
  if (!persona?.activa) {
    throw errorDeDatos(`La persona ${personaId} no está activa en esta organización.`);
  }
}

/** Temas de la ficha; sin ellos, el nombre del puesto hace de tema. */
function temasDeLaFicha(ficha: unknown, nombre: string): string[] {
  const temas = (ficha as { temas?: unknown } | null)?.temas;
  if (Array.isArray(temas) && temas.every((t) => typeof t === 'string') && temas.length > 0) {
    return temas as string[];
  }
  return [nombre];
}

export interface DecisionRegistrada {
  decision: DecisionDelModerador;
  yaEstaba: boolean;
}

/**
 * Encuentra la sala del departamento o la crea. Una por departamento: se busca por
 * `departamento_id` y no por nombre, así que dos ejecuciones a la vez no crean dos.
 */
async function asegurarSala(
  tx: postgres.TransactionSql,
  tenantId: string,
  departamento: { id: string; nombre: string },
): Promise<{ salaId: string; creada: boolean }> {
  const [existente] = await tx<{ id: string }[]>`
    select id from sala where tenant_id = ${tenantId} and departamento_id = ${departamento.id}
  `;
  if (existente) return { salaId: existente.id, creada: false };

  const [nueva] = await tx<{ id: string }[]>`
    insert into sala (tenant_id, departamento_id, ambito, nombre)
    values (${tenantId}, ${departamento.id}, 'departamento', ${`Sala de ${departamento.nombre}`})
    on conflict (tenant_id, nombre) do nothing
    returning id
  `;
  if (nueva) return { salaId: nueva.id, creada: true };

  // El nombre ya lo tenía otra sala (carrera, o el departamento se renombró y
  // volvió a su nombre anterior): se busca otra vez por departamento antes de
  // rendirse, que es la clave de verdad de esta función.
  const [rehecha] = await tx<{ id: string }[]>`
    select id from sala where tenant_id = ${tenantId} and departamento_id = ${departamento.id}
  `;
  if (!rehecha) {
    throw errorDeDatos(`La sala de «${departamento.nombre}» no se pudo crear ni encontrar.`);
  }
  return { salaId: rehecha.id, creada: false };
}

/**
 * Sincroniza los participantes de la sala de un equipo con lo que ya dice el
 * departamento: puestos activos o en prueba, y la persona que lo supervisa.
 *
 * Los puestos se añaden y se quitan: es una señal limpia y completa de quién
 * trabaja en el departamento ahora mismo. La persona supervisora solo se añade —
 * quitar participantes humanos que alguien metió a mano no es cosa de esta
 * sincronización— y su ausencia (departamento sin supervisor, o supervisor no
 * activo) no es un error. Cada alta y cada baja deja su propia entrada en el libro
 * (criterio de hecho de la rebanada).
 */
async function sincronizarParticipantesDeEquipo(
  tx: postgres.TransactionSql,
  tenantId: string,
  salaId: string,
  departamento: { id: string; supervisorPersonaId: string | null },
): Promise<{ anadidos: number; quitados: number }> {
  const puestosElegibles = await tx<{ id: string }[]>`
    select id from puesto
    where tenant_id = ${tenantId} and departamento_id = ${departamento.id}
      and estado in ('activo', 'en_prueba')
  `;
  const supervisorActivo = departamento.supervisorPersonaId
    ? await tx<{ id: string }[]>`
        select id from persona
        where tenant_id = ${tenantId} and id = ${departamento.supervisorPersonaId} and activa
      `
    : [];

  const actuales = await tx<{ persona_id: string | null; puesto_id: string | null }[]>`
    select persona_id, puesto_id from sala_participante
    where tenant_id = ${tenantId} and sala_id = ${salaId}
  `;
  const puestosActuales = new Set(
    actuales.map((f) => f.puesto_id).filter((id): id is string => id !== null),
  );
  const personasActuales = new Set(
    actuales.map((f) => f.persona_id).filter((id): id is string => id !== null),
  );

  let anadidos = 0;
  for (const puesto of puestosElegibles) {
    if (puestosActuales.has(puesto.id)) continue;
    const insertado = await tx`
      insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
      values (${tenantId}, ${salaId}, ${puesto.id}, 'agente')
      on conflict (tenant_id, sala_id, puesto_id) do nothing
    `;
    if (insertado.count === 0) continue;
    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId: puesto.id,
      accion: ACCIONES_SALA.miembroAnadido,
      datosReferenciados: [
        { tipo: 'sala', id: salaId },
        { tipo: 'puesto', id: puesto.id },
      ],
      resultado: 'exito',
    });
    anadidos += 1;
  }
  for (const persona of supervisorActivo) {
    if (personasActuales.has(persona.id)) continue;
    const insertado = await tx`
      insert into sala_participante (tenant_id, sala_id, persona_id, rol)
      values (${tenantId}, ${salaId}, ${persona.id}, 'humano')
      on conflict (tenant_id, sala_id, persona_id) do nothing
    `;
    if (insertado.count === 0) continue;
    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      actorId: persona.id,
      accion: ACCIONES_SALA.miembroAnadido,
      datosReferenciados: [
        { tipo: 'sala', id: salaId },
        { tipo: 'persona', id: persona.id },
      ],
      resultado: 'exito',
    });
    anadidos += 1;
  }

  const idsElegibles = new Set(puestosElegibles.map((p) => p.id));
  let quitados = 0;
  for (const puestoId of puestosActuales) {
    if (idsElegibles.has(puestoId)) continue;
    const borrado = await tx`
      delete from sala_participante
      where tenant_id = ${tenantId} and sala_id = ${salaId} and puesto_id = ${puestoId}
    `;
    if (borrado.count === 0) continue;
    await anotar(tx, tenantId, {
      actorTipo: 'plataforma',
      puestoId,
      accion: ACCIONES_SALA.miembroQuitado,
      datosReferenciados: [
        { tipo: 'sala', id: salaId },
        { tipo: 'puesto', id: puestoId },
      ],
      resultado: 'exito',
    });
    quitados += 1;
  }
  return { anadidos, quitados };
}

export function crearActividadesDeSala(contexto: ContextoDeActividades) {
  return {
    /**
     * Identificadores UUID v7 para lo que el flujo va a crear. El flujo no puede
     * generarlos con el reloj; como resultado de actividad quedan en el historial y
     * la reanudación usa los mismos, que es lo que hace idempotentes las demás.
     */
    async nuevosIdentificadores(peticion: { cantidad: number }): Promise<string[]> {
      return Array.from({ length: Math.max(0, Math.min(peticion.cantidad, 16)) }, () => uuidV7());
    },

    /** Publica el mensaje de la persona y lo anota. El identificador lo trae la API. */
    async publicarMensajeHumano(peticion: {
      tenantId: string;
      salaId: string;
      mensajeId: string;
      personaId: string;
      texto: string;
    }): Promise<{ creadoEn: string; yaEstaba: boolean }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        await exigirPersonaActiva(tx, peticion.tenantId, peticion.personaId);
        const [sala] = await tx<{ id: string }[]>`
          select id from sala where tenant_id = ${peticion.tenantId} and id = ${peticion.salaId}
        `;
        if (!sala) throw errorDeDatos(`La sala ${peticion.salaId} no existe en esta organización.`);
        const texto = peticion.texto.trim();
        if (texto.length === 0) throw errorDeDatos('Un mensaje vacío no se publica.');

        const insertado = await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: peticion.mensajeId,
          salaId: peticion.salaId,
          cuerpo: texto,
          autorPersonaId: peticion.personaId,
        });
        if (!insertado.yaEstaba) {
          await anotar(tx, peticion.tenantId, {
            actorTipo: 'persona',
            actorId: peticion.personaId,
            accion: ACCIONES_SALA.mensajePublicado,
            datosReferenciados: [
              { tipo: 'sala', id: peticion.salaId },
              { tipo: 'mensaje', id: peticion.mensajeId },
            ],
            resultado: 'exito',
          });
        }
        return { creadoEn: insertado.creadoEn.toISOString(), yaEstaba: insertado.yaEstaba };
      });
    },

    /**
     * El moderador decide y deja su nota plegada en la sala. La nota lleva la
     * decisión entera, y es lo que devuelve un reintento: decidir otra vez podría
     * dar otra cosa si entretanto cambió la sala.
     */
    async moderarMensaje(peticion: {
      tenantId: string;
      salaId: string;
      mensajeId: string;
      texto: string;
      notaId: string;
    }): Promise<DecisionRegistrada> {
      const lectura = await enTenant(contexto, peticion.tenantId, async (tx) => {
        const [previa] = await tx<{ adjuntos: unknown }[]>`
          select adjuntos from mensaje where tenant_id = ${peticion.tenantId} and id = ${peticion.notaId}
        `;
        if (previa) {
          const guardada = (previa.adjuntos as { tipo: string; decisionCompleta?: unknown }[]).find(
            (a) => a.tipo === 'moderacion',
          );
          return { yaEstaba: true as const, decision: guardada?.decisionCompleta as DecisionDelModerador };
        }

        const [sala] = await tx<{ ambito: string }[]>`
          select ambito::text as ambito from sala
          where tenant_id = ${peticion.tenantId} and id = ${peticion.salaId}
        `;
        const filas = await tx<{ id: string; nombre: string; estado: string; ficha: unknown }[]>`
          select p.id, p.nombre, p.estado, p.ficha
          from sala_participante sp
          join puesto p on p.tenant_id = sp.tenant_id and p.id = sp.puesto_id
          where sp.tenant_id = ${peticion.tenantId} and sp.sala_id = ${peticion.salaId}
          order by p.nombre
        `;
        const participantes: ParticipanteDeSala[] = filas.map((fila) => ({
          puestoId: fila.id,
          nombre: fila.nombre,
          estado: fila.estado,
          temas: temasDeLaFicha(fila.ficha, fila.nombre),
        }));
        return { yaEstaba: false as const, ambito: sala?.ambito ?? '', participantes };
      });
      if (lectura.yaEstaba) return { decision: lectura.decision, yaEstaba: true };

      // El paso de modelo corre fuera de la transacción: no se retiene una conexión
      // mientras se espera al proveedor. Un reintento tras esta llamada la repite, pero
      // solo cobra la que queda anotada en el libro (la de la escritura de abajo).
      const { decision, pasoDeModelo } = await moderarConModelo(peticion.texto, lectura.participantes, {
        ambito: lectura.ambito,
        clasificador: crearClasificadorDeSala(contexto, {
          tenantId: peticion.tenantId,
          mensajeId: peticion.mensajeId,
          papel: 'haiku45',
          clasePaso: 'moderador_sala',
          modeloDePrueba: MODELO_PRUEBA_MODERADOR,
        }),
      });
      const puestos = decision.tipo === 'intervenir' ? decision.turnos.map((t) => t.puestoId) : [];
      // Coste de sala visible aparte (ADR-004): lo que costó el paso de modelo, o cero
      // cuando decidieron las reglas, que no gastan modelo.
      const costeEuros = pasoDeModelo.usado ? pasoDeModelo.costeEuros : 0;

      return enTenant(contexto, peticion.tenantId, async (tx) => {
        await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: peticion.notaId,
          salaId: peticion.salaId,
          cuerpo: decision.motivo,
          adjuntos: [
            { tipo: 'autor_plataforma', agente: 'moderador' },
            // `decisionCompleta` es lo que devuelve el reintento; el resto, lo que pinta la sala.
            {
              tipo: 'moderacion',
              decision: decision.tipo,
              puestos,
              motivo: decision.motivo,
              pasoDeModelo,
              decisionCompleta: decision,
            } as AdjuntoDeSala,
          ],
        });
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'plataforma',
          accion: ACCIONES_SALA.moderacionDecidida,
          datosReferenciados: [
            { tipo: 'sala', id: peticion.salaId },
            { tipo: 'mensaje', id: peticion.mensajeId },
            ...puestos.map((id) => ({ tipo: 'puesto', id })),
          ],
          resultado: 'exito',
          costeEuros,
        });
        return { decision, yaEstaba: false };
      });
    },

    /**
     * Abre la intervención: una tarea raíz de origen `sala` (ADR-003: cada
     * intervención es una tarea ligera que suma al contador) y su fila de
     * `intervencion` con el motivo del moderador.
     */
    async abrirIntervencion(peticion: {
      tenantId: string;
      salaId: string;
      mensajeId: string;
      mensajeCreadoEn: string;
      puestoId: string;
      motivo: string;
      intervencionId: string;
      tareaId: string;
    }): Promise<{ tareaId: string; puestoId: string; versionPuestoId: string; yaEstaba: boolean }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [puesto] = await tx<
          { estado: string; version_activa_id: string | null; politica: unknown }[]
        >`
          select p.estado, p.version_activa_id, v.politica
          from puesto p
          left join version_puesto v on v.tenant_id = p.tenant_id and v.id = p.version_activa_id
          where p.tenant_id = ${peticion.tenantId} and p.id = ${peticion.puestoId}
        `;
        if (!puesto?.version_activa_id) {
          throw errorDeDatos(`El puesto ${peticion.puestoId} no existe o no tiene versión activa.`);
        }
        const versionPuestoId = puesto.version_activa_id;

        const [previa] = await tx<{ id: string }[]>`
          select id from intervencion
          where tenant_id = ${peticion.tenantId} and id = ${peticion.intervencionId}
        `;
        if (previa) {
          return {
            tareaId: peticion.tareaId,
            puestoId: peticion.puestoId,
            versionPuestoId,
            yaEstaba: true,
          };
        }

        const presupuesto =
          (puesto.politica as { presupuestoPorTareaEuros?: number } | null)
            ?.presupuestoPorTareaEuros ?? null;
        await tx`
          insert into tarea (
            id, tenant_id, puesto_id, version_puesto_id, origen, origen_referencia_id,
            estado, presupuesto_euros
          ) values (
            ${peticion.tareaId}, ${peticion.tenantId}, ${peticion.puestoId}, ${versionPuestoId},
            'sala', ${peticion.salaId}, 'pendiente', ${presupuesto}
          )
        `;
        // Raíz de sí misma: así el contador la reconoce como unidad de consumo.
        await tx`update tarea set tarea_raiz_id = id where tenant_id = ${peticion.tenantId} and id = ${peticion.tareaId}`;
        await tx`
          insert into intervencion (
            id, tenant_id, sala_id, mensaje_id, mensaje_creado_en, tarea_id, motivo
          ) values (
            ${peticion.intervencionId}, ${peticion.tenantId}, ${peticion.salaId},
            ${peticion.mensajeId}, ${peticion.mensajeCreadoEn}, ${peticion.tareaId}, ${peticion.motivo}
          )
        `;
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'plataforma',
          puestoId: peticion.puestoId,
          versionPuestoId,
          tareaId: peticion.tareaId,
          accion: ACCIONES_SALA.intervencionAbierta,
          datosReferenciados: [
            { tipo: 'sala', id: peticion.salaId },
            { tipo: 'mensaje', id: peticion.mensajeId },
            { tipo: 'intervencion', id: peticion.intervencionId },
          ],
          resultado: 'exito',
        });
        return {
          tareaId: peticion.tareaId,
          puestoId: peticion.puestoId,
          versionPuestoId,
          yaEstaba: false,
        };
      });
    },

    /** Publica en la sala lo que respondió el agente o un agente de plataforma. */
    async publicarRespuesta(peticion: {
      tenantId: string;
      salaId: string;
      mensajeId: string;
      texto: string;
      puestoId?: string | undefined;
      tareaId?: string | undefined;
      adjuntos: AdjuntoDeSala[];
    }): Promise<{ yaEstaba: boolean }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const insertado = await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: peticion.mensajeId,
          salaId: peticion.salaId,
          cuerpo: peticion.texto,
          autorPuestoId: peticion.puestoId ?? null,
          adjuntos: peticion.adjuntos,
        });
        if (!insertado.yaEstaba) {
          await anotar(tx, peticion.tenantId, {
            actorTipo: peticion.puestoId ? 'agente' : 'plataforma',
            actorId: peticion.puestoId ?? null,
            puestoId: peticion.puestoId ?? null,
            tareaId: peticion.tareaId ?? null,
            accion: ACCIONES_SALA.respuestaPublicada,
            datosReferenciados: [
              { tipo: 'sala', id: peticion.salaId },
              { tipo: 'mensaje', id: peticion.mensajeId },
            ],
            resultado: 'exito',
          });
        }
        return { yaEstaba: insertado.yaEstaba };
      });
    },

    /**
     * El Director convierte la frase en una propuesta de operación y la presenta en
     * la sala. Si no puede proponer, lo explica en la sala y no crea nada.
     */
    async proponerOperacion(peticion: {
      tenantId: string;
      salaId: string;
      mensajeId: string;
      personaId: string;
      texto: string;
      propuestaId: string;
      respuestaId: string;
    }): Promise<{ propuestaId: string | null; caducidadSegundos: number }> {
      const lectura = await enTenant(contexto, peticion.tenantId, async (tx) => {
        const [previa] = await tx<{ id: string; efectos_previstos: { caducidadDias?: number } }[]>`
          select id, efectos_previstos from propuesta_operacion
          where tenant_id = ${peticion.tenantId} and id = ${peticion.propuestaId}
        `;
        if (previa) {
          return {
            yaEstaba: true as const,
            resultado: {
              propuestaId: previa.id,
              caducidadSegundos: (previa.efectos_previstos.caducidadDias ?? 7) * SEGUNDOS_POR_DIA,
            },
          };
        }

        const [sala] = await tx<{ ambito: string }[]>`
          select ambito::text as ambito from sala
          where tenant_id = ${peticion.tenantId} and id = ${peticion.salaId}
        `;
        const departamentos = await tx<{ id: string; nombre: string; estado: string }[]>`
          select id, nombre, estado from departamento where tenant_id = ${peticion.tenantId}
        `;
        const puestos = await tx<
          {
            id: string;
            nombre: string;
            departamento_id: string;
            estado: string;
            plantilla_id: string | null;
          }[]
        >`
          select id, nombre, departamento_id, estado, ficha #>> '{plantilla,id}' as plantilla_id
          from puesto where tenant_id = ${peticion.tenantId}
        `;
        // «Catálogo de conectores ya autorizados» (plan v8): lo que la organización ya
        // autorizó en cada conector activo. No se abre ninguna conexión desde aquí.
        const conectores = await tx<
          { id: string; nombre: string; herramientas: string[] | null }[]
        >`
          select c.id, c.nombre,
            (select array_agg(distinct h)
               from autorizacion_herramientas a, jsonb_array_elements_text(a.lista_blanca) h
              where a.tenant_id = c.tenant_id and a.conector_id = c.id and a.revocada_en is null
            ) as herramientas
          from conector c
          where c.tenant_id = ${peticion.tenantId} and c.estado = 'activo'
          order by c.nombre
        `;
        const contextoDelDirector = {
          departamentos: departamentos.map((d) => ({ ...d })),
          puestos: puestos.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            departamentoId: p.departamento_id,
            estado: p.estado,
            plantillaId: p.plantilla_id ?? undefined,
          })),
          conectores: conectores.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            herramientasAutorizadas: c.herramientas ?? [],
          })),
        };
        return { yaEstaba: false as const, ambito: sala?.ambito ?? '', contextoDelDirector };
      });
      if (lectura.yaEstaba) return lectura.resultado;

      // El paso de modelo corre fuera de la transacción (ver `moderarMensaje`).
      const { respuesta, pasoDeModelo } = await proponerContratacionConModelo(
        peticion.texto,
        lectura.contextoDelDirector,
        {
          ambito: lectura.ambito,
          clasificador: crearClasificadorDeSala(contexto, {
            tenantId: peticion.tenantId,
            mensajeId: peticion.mensajeId,
            papel: 'sonnet5',
            clasePaso: 'enrutado',
            modeloDePrueba: MODELO_PRUEBA_DIRECTOR,
          }),
        },
      );
      const costeEuros = pasoDeModelo.usado ? pasoDeModelo.costeEuros : 0;

      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const autor: AdjuntoDeSala = { tipo: 'autor_plataforma', agente: 'director_ia' };
        if (respuesta.tipo === 'aclaracion') {
          const insertado = await insertarMensaje(contexto, tx, peticion.tenantId, {
            id: peticion.respuestaId,
            salaId: peticion.salaId,
            cuerpo: respuesta.mensaje,
            adjuntos: [autor],
          });
          if (!insertado.yaEstaba) {
            await anotar(tx, peticion.tenantId, {
              actorTipo: 'plataforma',
              accion: ACCIONES_SALA.respuestaPublicada,
              datosReferenciados: [
                { tipo: 'sala', id: peticion.salaId },
                { tipo: 'mensaje', id: peticion.respuestaId },
              ],
              resultado: 'exito',
              // El coste del paso de modelo no se pierde si acaba en aclaración.
              costeEuros,
            });
          }
          return { propuestaId: null, caducidadSegundos: 0 };
        }

        const propuesta = respuesta.propuesta;
        await tx`
          insert into propuesta_operacion (
            id, tenant_id, tipo, actor_tipo, resumen, entidades_tocadas, efectos_previstos,
            coste_estimado_euros, evidencia, nivel_exigido, estado, forma_reversion
          ) values (
            ${peticion.propuestaId}, ${peticion.tenantId}, 'contratar', 'plataforma',
            ${propuesta.resumen},
            ${JSON.stringify(propuesta.entidadesTocadas)}::text::jsonb,
            ${JSON.stringify(propuesta)}::text::jsonb,
            ${propuesta.coste.eurosMesCliente},
            ${JSON.stringify({ frase: peticion.texto, mensajeId: peticion.mensajeId, personaId: peticion.personaId, salaId: peticion.salaId, pasoDeModelo })}::text::jsonb,
            ${propuesta.nivelExigido}, 'pendiente',
            ${JSON.stringify(propuesta.reversion)}::text::jsonb
          )
        `;
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'plataforma',
          accion: ACCIONES_SALA.propuestaCreada,
          datosReferenciados: [
            { tipo: 'propuesta_operacion', id: peticion.propuestaId },
            { tipo: 'mensaje', id: peticion.mensajeId },
            ...propuesta.entidadesTocadas,
          ],
          resultado: 'exito',
          nivelAplicado: propuesta.nivelExigido,
          costeEuros,
        });
        await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: peticion.respuestaId,
          salaId: peticion.salaId,
          cuerpo: respuesta.mensaje,
          adjuntos: [autor, { tipo: 'propuesta_operacion', propuestaId: peticion.propuestaId }],
        });
        return {
          propuestaId: peticion.propuestaId,
          caducidadSegundos: propuesta.caducidadDias * SEGUNDOS_POR_DIA,
        };
      });
    },

    /**
     * Registra la decisión sobre la propuesta: el clic de la persona o la caducidad.
     * Una propuesta ya decidida no cambia; el reintento devuelve lo que había.
     */
    async decidirPropuesta(peticion: {
      tenantId: string;
      propuestaId: string;
      sentido: 'aprobada' | 'rechazada' | 'caducada';
      personaId: string | null;
      motivo?: string | undefined;
      salaId: string;
      avisoId: string;
    }): Promise<{ estado: string; decididaPorPersonaId: string | null }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [propuesta] = await tx<
          { estado: string; decidida_por_persona_id: string | null; resumen: string }[]
        >`
          select estado, decidida_por_persona_id, resumen from propuesta_operacion
          where tenant_id = ${peticion.tenantId} and id = ${peticion.propuestaId}
          for update
        `;
        if (!propuesta) throw errorDeDatos(`La propuesta ${peticion.propuestaId} no existe.`);
        if (propuesta.estado !== 'pendiente') {
          return {
            estado: propuesta.estado,
            decididaPorPersonaId: propuesta.decidida_por_persona_id,
          };
        }
        if (peticion.personaId !== null) {
          await exigirPersonaActiva(tx, peticion.tenantId, peticion.personaId);
        }

        const estado = peticion.sentido === 'aprobada' ? 'aprobada' : 'rechazada';
        const motivo =
          peticion.sentido === 'caducada'
            ? 'Caducada sin decisión: la política de respaldo la rechaza y avisa en la sala (ADR-014).'
            : (peticion.motivo ?? null);
        await tx`
          update propuesta_operacion set
            estado = ${estado},
            decidida_por_persona_id = ${peticion.personaId},
            motivo_decision = ${motivo},
            actualizado_en = clock_timestamp()
          where tenant_id = ${peticion.tenantId} and id = ${peticion.propuestaId}
        `;
        const accion =
          peticion.sentido === 'aprobada'
            ? ACCIONES_SALA.propuestaAprobada
            : peticion.sentido === 'rechazada'
              ? ACCIONES_SALA.propuestaRechazada
              : ACCIONES_SALA.propuestaCaducada;
        await anotar(tx, peticion.tenantId, {
          actorTipo: peticion.personaId ? 'persona' : 'plataforma',
          actorId: peticion.personaId,
          accion,
          datosReferenciados: [{ tipo: 'propuesta_operacion', id: peticion.propuestaId }],
          resultado: 'exito',
          aprobadaPorPersonaId: peticion.sentido === 'aprobada' ? peticion.personaId : null,
        });
        if (peticion.sentido !== 'aprobada') {
          await insertarMensaje(contexto, tx, peticion.tenantId, {
            id: peticion.avisoId,
            salaId: peticion.salaId,
            cuerpo:
              peticion.sentido === 'caducada'
                ? `La propuesta «${propuesta.resumen}» caducó sin respuesta y queda descartada.`
                : `Entendido: descarto «${propuesta.resumen}».`,
            adjuntos: [
              { tipo: 'autor_plataforma', agente: 'director_ia' },
              { tipo: 'propuesta_operacion', propuestaId: peticion.propuestaId },
            ],
          });
        }
        return { estado, decididaPorPersonaId: peticion.personaId };
      });
    },

    /**
     * Ejecuta la contratación aprobada: puesto en prueba, versión, lista blanca en
     * los conectores con herramientas disponibles, sitio en la sala y presentación.
     *
     * Idempotente de verdad y no solo por reintento: la fila de la propuesta se
     * bloquea y, si ya está ejecutada, devuelve el puesto que creó. Dos clics, dos
     * trabajadores o un reintento dejan un puesto.
     */
    async ejecutarContratacion(peticion: {
      tenantId: string;
      propuestaId: string;
      salaId: string;
      presentacionId: string;
    }): Promise<{ puestoId: string; versionPuestoId: string; yaEstaba: boolean }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [fila] = await tx<
          {
            estado: string;
            efectos_previstos: PropuestaDeContratacion;
            decidida_por_persona_id: string | null;
            forma_reversion: { puestoId?: string; versionPuestoId?: string };
          }[]
        >`
          select estado, efectos_previstos, decidida_por_persona_id, forma_reversion
          from propuesta_operacion
          where tenant_id = ${peticion.tenantId} and id = ${peticion.propuestaId}
          for update
        `;
        if (!fila) throw errorDeDatos(`La propuesta ${peticion.propuestaId} no existe.`);
        if (fila.estado === 'ejecutada' && fila.forma_reversion.puestoId) {
          return {
            puestoId: fila.forma_reversion.puestoId,
            versionPuestoId: fila.forma_reversion.versionPuestoId ?? '',
            yaEstaba: true,
          };
        }
        if (fila.estado !== 'aprobada') {
          throw errorDeDatos(
            `La propuesta ${peticion.propuestaId} está ${fila.estado}: solo se ejecuta una aprobada.`,
          );
        }
        const propuesta = fila.efectos_previstos;
        const { puesto } = propuesta;

        const [creado] = await tx<{ id: string }[]>`
          insert into puesto (tenant_id, departamento_id, nombre, ficha, clase_riesgo, estado, enrutado_modelo)
          values (
            ${peticion.tenantId}, ${propuesta.departamento.id}, ${puesto.nombre},
            ${JSON.stringify(puesto.ficha)}::text::jsonb, ${puesto.claseRiesgo}, 'en_prueba',
            ${JSON.stringify(puesto.enrutadoModelo)}::text::jsonb
          )
          returning id
        `;
        if (!creado) throw new Error('El puesto no se insertó.');
        const [version] = await tx<{ id: string }[]>`
          insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
          values (
            ${peticion.tenantId}, ${creado.id}, 1, ${puesto.prompt},
            ${JSON.stringify(puesto.politica)}::text::jsonb
          )
          returning id
        `;
        if (!version) throw new Error('La versión del puesto no se insertó.');
        await tx`update puesto set version_activa_id = ${version.id} where tenant_id = ${peticion.tenantId} and id = ${creado.id}`;

        // Lista blanca por conector: solo lo que la plantilla pide y el conector ya
        // ofrece. Lo que falta queda por conectar y no se concede nada en su nombre.
        const porConector = new Map<string, string[]>();
        for (const herramienta of propuesta.herramientas.disponibles) {
          porConector.set(herramienta.conectorId, [
            ...(porConector.get(herramienta.conectorId) ?? []),
            herramienta.nombre,
          ]);
        }
        const autorizaciones: string[] = [];
        for (const [conectorId, listaBlanca] of porConector) {
          const [autorizacion] = await tx<{ id: string }[]>`
            insert into autorizacion_herramientas (
              tenant_id, puesto_id, conector_id, lista_blanca, niveles_por_clase, concedida_por_persona_id
            ) values (
              ${peticion.tenantId}, ${creado.id}, ${conectorId},
              ${JSON.stringify(listaBlanca)}::text::jsonb,
              ${JSON.stringify(puesto.politica.niveles)}::text::jsonb,
              ${fila.decidida_por_persona_id}
            )
            returning id
          `;
          if (autorizacion) autorizaciones.push(autorizacion.id);
        }
        await tx`
          insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
          values (${peticion.tenantId}, ${peticion.salaId}, ${creado.id}, 'agente')
        `;
        await tx`
          update propuesta_operacion set
            estado = 'ejecutada',
            ejecutada_en = clock_timestamp(),
            forma_reversion = forma_reversion || ${JSON.stringify({ puestoId: creado.id, versionPuestoId: version.id })}::text::jsonb,
            actualizado_en = clock_timestamp()
          where tenant_id = ${peticion.tenantId} and id = ${peticion.propuestaId}
        `;
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'plataforma',
          puestoId: creado.id,
          versionPuestoId: version.id,
          accion: ACCIONES_SALA.puestoContratado,
          datosReferenciados: [
            { tipo: 'propuesta_operacion', id: peticion.propuestaId },
            { tipo: 'departamento', id: propuesta.departamento.id },
            ...autorizaciones.map((id) => ({ tipo: 'autorizacion_herramientas', id })),
          ],
          resultado: 'exito',
          aprobadaPorPersonaId: fila.decidida_por_persona_id,
          nivelAplicado: propuesta.nivelExigido,
        });

        const faltan = propuesta.herramientas.porConectar.map((h) => h.nombre).join(', ');
        await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: peticion.presentacionId,
          salaId: peticion.salaId,
          autorPuestoId: creado.id,
          cuerpo:
            `Hola, soy ${puesto.nombre}, de ${propuesta.departamento.nombre}. ${puesto.ficha.mision} ` +
            `Estoy en prueba ${puesto.diasDePrueba} días: todo lo que escriba en un sistema pasa ` +
            `antes por vuestra aprobación.` +
            (faltan ? ` Para hacerlo todo me falta conectar: ${faltan}.` : ''),
          adjuntos: [{ tipo: 'propuesta_operacion', propuestaId: peticion.propuestaId }],
        });
        await anotar(tx, peticion.tenantId, {
          actorTipo: 'agente',
          actorId: creado.id,
          puestoId: creado.id,
          versionPuestoId: version.id,
          accion: ACCIONES_SALA.respuestaPublicada,
          datosReferenciados: [
            { tipo: 'sala', id: peticion.salaId },
            { tipo: 'mensaje', id: peticion.presentacionId },
          ],
          resultado: 'exito',
        });
        return { puestoId: creado.id, versionPuestoId: version.id, yaEstaba: false };
      });
    },

    /**
     * Sala v1: crea la sala del departamento si falta y sincroniza sus
     * participantes. La llama el flujo `sincronizarSalaDeEquipo`, idempotente por
     * departamento («la sala se crea con el equipo», criterio de hecho).
     */
    async asegurarSalaDeEquipo(peticion: {
      tenantId: string;
      departamentoId: string;
    }): Promise<{ salaId: string; creada: boolean; anadidos: number; quitados: number }> {
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [departamento] = await tx<
          { id: string; nombre: string; supervisor_persona_id: string | null }[]
        >`
          select id, nombre, supervisor_persona_id from departamento
          where tenant_id = ${peticion.tenantId} and id = ${peticion.departamentoId}
        `;
        if (!departamento) {
          throw errorDeDatos(`El departamento ${peticion.departamentoId} no existe.`);
        }
        const { salaId, creada } = await asegurarSala(tx, peticion.tenantId, departamento);
        const { anadidos, quitados } = await sincronizarParticipantesDeEquipo(
          tx,
          peticion.tenantId,
          salaId,
          { id: departamento.id, supervisorPersonaId: departamento.supervisor_persona_id },
        );
        return { salaId, creada, anadidos, quitados };
      });
    },
  };
}

export type ActividadesDeSala = ReturnType<typeof crearActividadesDeSala>;
