/**
 * Sala v0 contra PostgreSQL y, si hay servidor de pruebas, contra Temporal.
 *
 * La primera mitad llama a las actividades en el orden en que las llama el flujo:
 * así los criterios de hecho —intervención, propuesta, contratación, libro y
 * contador— se comprueban contra la base real sin necesitar Temporal. La segunda
 * mitad arranca los flujos de verdad y se salta con motivo si no hay servidor.
 */
import { conTenant, uuidV7 } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO } from '@aiw/db/pruebas';
import {
  ACCION_TAREA_CONTADA,
  ACCION_USO_MODELO,
  registrarTarifa,
  verificarCadenaEnBase,
} from '@aiw/ledger';
import { MODELO_PRUEBA_DIRECTOR, MODELO_PRUEBA_MODERADOR } from '@aiw/models';
import {
  FLUJO_MENSAJE_DE_SALA,
  FLUJO_PROPUESTA_DE_OPERACION,
  idFlujoMensaje,
  idFlujoPropuesta,
  type DecisionDelModerador,
} from '@aiw/rooms';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ACCIONES_SALA } from '../actividades/sala.js';
import type { OperacionesDelBucle } from '../bucle/bucle.js';
import { ejecutarBucle } from '../bucle/bucle.js';
import { decisionDePropuesta, mensajeDeSala, propuestaDeOperacion } from '../flujos/index.js';
import { RUTA_FLUJOS } from '../trabajador.js';
import { crearActividades } from '../actividades/index.js';
import { SECRETO_DE_PRUEBA, montarSalaParaPruebas, type MontajeDeSala } from './montaje.js';
import { arrancarEntorno, contarEnElLibro } from './temporal.js';
import { TARIFA_DE_PRUEBA } from '../semilla.js';

const PREGUNTA = '¿cómo vamos de cobros este mes?';
const FRASE = 'contrata un agente de conciliación en Finanzas';
// Sin ningún tema de la ficha de Cobros ni expresión de contratar: solo el modelo la entiende.
const PARAFRASIS_DE_COBROS = 'quién nos debe dinero desde hace más de dos meses';
const PARAFRASIS_DE_CONTRATAR =
  'queremos que alguien pase los movimientos del banco contra las facturas en Finanzas';

async function mensajesDeLaSala(montaje: MontajeDeSala) {
  return conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => [
    ...(await tx<
      {
        id: string;
        cuerpo: string;
        autor_persona_id: string | null;
        autor_puesto_id: string | null;
        adjuntos: { tipo: string; agente?: string; propuestaId?: string }[];
      }[]
    >`
      select id, cuerpo, autor_persona_id, autor_puesto_id, adjuntos from mensaje
      where tenant_id = ${montaje.semilla.tenantId} and sala_id = ${montaje.semilla.salaId}
      order by creado_en, id
    `),
  ]);
}

async function propuesta(montaje: MontajeDeSala, id: string) {
  const [fila] = await conTenant(
    montaje.cliente,
    montaje.semilla.tenantId,
    (tx) => tx<
      {
        tipo: string;
        estado: string;
        nivel_exigido: string;
        coste_estimado_euros: string;
        efectos_previstos: Record<string, unknown>;
        forma_reversion: { operacion: string; puestoId?: string };
        decidida_por_persona_id: string | null;
      }[]
    >`
      select tipo, estado, nivel_exigido, coste_estimado_euros, efectos_previstos,
             forma_reversion, decidida_por_persona_id
      from propuesta_operacion
      where tenant_id = ${montaje.semilla.tenantId} and id = ${id}
    `,
  );
  return fila;
}

/** Ejecuta la intervención como la ejecuta `tareaAgente` con `soloLectura`. */
async function intervenir(
  montaje: MontajeDeSala,
  identidad: { tenantId: string; puestoId: string; versionPuestoId: string; tareaId: string },
  encargo: string,
) {
  const actividades = montaje.actividades;
  await actividades.arrancarTarea({
    ...identidad,
    flujoTemporalId: `prueba-${identidad.tareaId}`,
    ejecucionTemporalId: 'sin-temporal',
  });
  const operaciones: OperacionesDelBucle = {
    leerContexto: async () => {
      const contexto = await actividades.leerContexto(identidad);
      return {
        ...contexto,
        herramientas: contexto.herramientas.filter((h) => h.tipo === 'lectura'),
      };
    },
    pasoModelo: (peticion) => actividades.pasoModelo(peticion),
    pasoHerramienta: (peticion) => actividades.pasoHerramienta(peticion),
    pedirAprobacion: (peticion) => actividades.pedirAprobacion(peticion),
    esperarDecision: () => Promise.reject(new Error('Una intervención no pide aprobaciones.')),
    anotarPaso: (peticion) => actividades.anotarPaso(peticion),
    senalDeAprendizaje: (peticion) => actividades.senalDeAprendizaje(peticion),
  };
  return ejecutarBucle(operaciones, { ...identidad, encargo, soloLectura: true, maxPasos: 4 });
}

describe('nombres compartidos entre la API y el trabajador', () => {
  it('los flujos se registran con los nombres de @aiw/rooms', () => {
    expect(mensajeDeSala.name).toBe(FLUJO_MENSAJE_DE_SALA);
    expect(propuestaDeOperacion.name).toBe(FLUJO_PROPUESTA_DE_OPERACION);
  });
});

describe.skipIf(!HAY_BASE_DE_DATOS)('sala v0 · actividades contra la base y el libro', () => {
  const montajes: MontajeDeSala[] = [];
  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((m) => m.cerrar()));
  });

  async function preparar(nombre: string) {
    const montaje = await montarSalaParaPruebas(`${nombre} ${uuidV7()}`);
    montajes.push(montaje);
    return montaje;
  }

  async function publicarYModerar(montaje: MontajeDeSala, texto: string) {
    const [mensajeId = '', notaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    const base = { tenantId: montaje.semilla.tenantId, salaId: montaje.semilla.salaId };
    const publicado = await montaje.actividades.publicarMensajeHumano({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto,
    });
    const moderado = await montaje.actividades.moderarMensaje({
      ...base,
      mensajeId,
      texto,
      notaId,
    });
    return { mensajeId, notaId, publicado, decision: moderado.decision, base };
  }

  it('la pregunta de cobros produce una intervención de Cobros elegida por el moderador', async () => {
    const montaje = await preparar('Sala cobros');
    const { mensajeId, notaId, publicado, decision, base } = await publicarYModerar(
      montaje,
      PREGUNTA,
    );
    expect(decision.tipo).toBe('intervenir');
    const turno = decision.tipo === 'intervenir' ? decision.turnos[0] : undefined;
    expect(turno?.puestoId).toBe(montaje.semilla.cobros.puestoId);

    const [intervencionId = '', tareaId = '', respuestaId = ''] =
      await montaje.actividades.nuevosIdentificadores({ cantidad: 3 });
    const abierta = await montaje.actividades.abrirIntervencion({
      ...base,
      mensajeId,
      mensajeCreadoEn: publicado.creadoEn,
      puestoId: turno?.puestoId ?? '',
      motivo: turno?.motivo ?? '',
      intervencionId,
      tareaId,
    });
    const resultado = await intervenir(montaje, { tenantId: base.tenantId, ...abierta }, PREGUNTA);
    expect(resultado.estado).toBe('completada');
    expect(resultado.escriturasEjecutadas).toBe(0);
    expect(resultado.aprobacionesPedidas).toBe(0);
    await montaje.actividades.publicarRespuesta({
      ...base,
      mensajeId: respuestaId,
      texto: resultado.resumen,
      puestoId: abierta.puestoId,
      tareaId,
      adjuntos: [{ tipo: 'intervencion', intervencionId, tareaId, estado: resultado.estado }],
    });

    // La sala: pregunta, nota plegada del moderador y respuesta agregada de Cobros.
    const mensajes = await mensajesDeLaSala(montaje);
    expect(mensajes.map((m) => m.id)).toEqual([mensajeId, notaId, respuestaId]);
    expect(mensajes[1]?.adjuntos[0]).toMatchObject({
      tipo: 'autor_plataforma',
      agente: 'moderador',
    });
    const respuesta = mensajes[2];
    expect(respuesta?.autor_puesto_id).toBe(montaje.semilla.cobros.puestoId);
    expect(respuesta?.cuerpo).toMatch(/\d+ facturas? vencidas? por [\d.]+ €/);
    expect(respuesta?.cuerpo).not.toMatch(/F-2026|S\.L\./);

    const [fila] = await conTenant(
      montaje.cliente,
      base.tenantId,
      (tx) => tx<{ motivo: string; origen: string; tarea_raiz_id: string }[]>`
        select i.motivo, t.origen, t.tarea_raiz_id from intervencion i
        join tarea t on t.tenant_id = i.tenant_id and t.id = i.tarea_id
        where i.tenant_id = ${base.tenantId} and i.id = ${intervencionId}
      `,
    );
    expect(fila).toMatchObject({ origen: 'sala', tarea_raiz_id: tareaId });
    expect(fila?.motivo).toContain('«cobro»');

    // Libro y contador: una tarea contada, la de la intervención; moderar no cuenta.
    const contar = (accion: string) => contarEnElLibro(montaje.cliente, base.tenantId, { accion });
    expect(await contar(ACCIONES_SALA.mensajePublicado)).toBe(1);
    expect(await contar(ACCIONES_SALA.moderacionDecidida)).toBe(1);
    expect(await contar(ACCIONES_SALA.intervencionAbierta)).toBe(1);
    expect(await contar(ACCIONES_SALA.respuestaPublicada)).toBe(1);
    expect(await contar('tarea.contada')).toBe(1);

    // Idempotencia: el reintento de cada actividad no duplica nada.
    const otra = await montaje.actividades.publicarMensajeHumano({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: PREGUNTA,
    });
    expect(otra.yaEstaba).toBe(true);
    const remoderado = await montaje.actividades.moderarMensaje({
      ...base,
      mensajeId,
      texto: PREGUNTA,
      notaId,
    });
    expect(remoderado.yaEstaba).toBe(true);
    expect(remoderado.decision).toEqual(decision);
    const reabierta = await montaje.actividades.abrirIntervencion({
      ...base,
      mensajeId,
      mensajeCreadoEn: publicado.creadoEn,
      puestoId: abierta.puestoId,
      motivo: 'otro',
      intervencionId,
      tareaId,
    });
    expect(reabierta.yaEstaba).toBe(true);
    expect(await contar(ACCIONES_SALA.moderacionDecidida)).toBe(1);
    expect(await contar(ACCIONES_SALA.intervencionAbierta)).toBe(1);
    expect((await mensajesDeLaSala(montaje)).length).toBe(3);

    const verificacion = await verificarCadenaEnBase(montaje.cliente, base.tenantId);
    expect(verificacion.valida).toBe(true);
  });

  it('la frase de contratación produce la propuesta, un clic la ejecuta y el puesto arranca en prueba', async () => {
    const montaje = await preparar('Sala contratar');
    const { mensajeId, decision, base } = await publicarYModerar(montaje, FRASE);
    expect(decision).toMatchObject({ tipo: 'operacion', operacion: 'contratar' });

    const [propuestaId = '', respuestaId = '', avisoId = '', presentacionId = ''] =
      await montaje.actividades.nuevosIdentificadores({ cantidad: 4 });
    const propuesta1 = await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: FRASE,
      propuestaId,
      respuestaId,
    });
    expect(propuesta1).toEqual({ propuestaId, caducidadSegundos: 7 * 24 * 60 * 60 });

    const creada = await propuesta(montaje, propuestaId);
    expect(creada).toMatchObject({ tipo: 'contratar', estado: 'pendiente', nivel_exigido: 'n1' });
    expect(Number(creada?.coste_estimado_euros)).toBe(50);
    const efectos = creada?.efectos_previstos as {
      puesto: { ficha: { mision: string }; estadoInicial: string };
      herramientas: { disponibles: { nombre: string }[]; porConectar: { nombre: string }[] };
      guardrails: unknown[];
      coste: { tareasMes: number };
    };
    expect(efectos.puesto.ficha.mision.length).toBeGreaterThan(10);
    expect(efectos.puesto.estadoInicial).toBe('en_prueba');
    expect(efectos.herramientas.disponibles.map((h) => h.nombre)).toEqual([
      'listar_facturas_vencidas',
      'crear_nota_seguimiento',
    ]);
    expect(efectos.herramientas.porConectar.length).toBe(2);
    expect(efectos.guardrails.length).toBeGreaterThanOrEqual(3);
    expect(efectos.coste.tareasMes).toBe(110);
    expect(creada?.forma_reversion.operacion).toBe('dar_de_baja');

    // La tarjeta del Director en la sala apunta a la propuesta.
    const tarjeta = (await mensajesDeLaSala(montaje)).find((m) => m.id === respuestaId);
    expect(tarjeta?.adjuntos).toEqual([
      { tipo: 'autor_plataforma', agente: 'director_ia' },
      { tipo: 'propuesta_operacion', propuestaId },
    ]);

    // Una persona que no existe no decide, y la propuesta sigue pendiente.
    await expect(
      montaje.actividades.decidirPropuesta({
        ...base,
        propuestaId,
        sentido: 'aprobada',
        personaId: uuidV7(),
        avisoId,
      }),
    ).rejects.toThrow(/no está activa/);
    expect((await propuesta(montaje, propuestaId))?.estado).toBe('pendiente');

    // El clic.
    const decidida = await montaje.actividades.decidirPropuesta({
      ...base,
      propuestaId,
      sentido: 'aprobada',
      personaId: montaje.semilla.personaId,
      avisoId,
    });
    expect(decidida.estado).toBe('aprobada');
    const contratado = await montaje.actividades.ejecutarContratacion({
      ...base,
      propuestaId,
      presentacionId,
    });
    expect(contratado.yaEstaba).toBe(false);

    const [puesto] = await conTenant(
      montaje.cliente,
      base.tenantId,
      (tx) => tx<
        { nombre: string; estado: string; version_activa_id: string; plantilla: string }[]
      >`
        select nombre, estado, version_activa_id, ficha #>> '{plantilla,id}' as plantilla
        from puesto where tenant_id = ${base.tenantId} and id = ${contratado.puestoId}
      `,
    );
    expect(puesto).toMatchObject({
      nombre: 'Conciliación bancaria',
      estado: 'en_prueba',
      version_activa_id: contratado.versionPuestoId,
      plantilla: 'finanzas.conciliacion-bancaria',
    });
    const autorizaciones = await conTenant(
      montaje.cliente,
      base.tenantId,
      (tx) => tx<{ lista_blanca: string[]; concedida_por_persona_id: string }[]>`
        select lista_blanca, concedida_por_persona_id from autorizacion_herramientas
        where tenant_id = ${base.tenantId} and puesto_id = ${contratado.puestoId}
      `,
    );
    expect(autorizaciones).toHaveLength(1);
    expect(autorizaciones[0]?.lista_blanca).toEqual([
      'listar_facturas_vencidas',
      'crear_nota_seguimiento',
    ]);
    expect(autorizaciones[0]?.concedida_por_persona_id).toBe(montaje.semilla.personaId);
    const ejecutada = await propuesta(montaje, propuestaId);
    expect(ejecutada?.estado).toBe('ejecutada');
    expect(ejecutada?.forma_reversion.puestoId).toBe(contratado.puestoId);

    const presentacion = (await mensajesDeLaSala(montaje)).find((m) => m.id === presentacionId);
    expect(presentacion?.autor_puesto_id).toBe(contratado.puestoId);
    expect(presentacion?.cuerpo).toContain('Estoy en prueba 30 días');
    expect(presentacion?.cuerpo).toContain('leer_extracto_bancario');

    // Dos clics, un puesto: repetir no crea nada ni cambia la decisión.
    const otraVez = await montaje.actividades.ejecutarContratacion({
      ...base,
      propuestaId,
      presentacionId,
    });
    expect(otraVez).toEqual({ ...contratado, yaEstaba: true });
    const tarde = await montaje.actividades.decidirPropuesta({
      ...base,
      propuestaId,
      sentido: 'rechazada',
      personaId: montaje.semilla.personaId,
      avisoId,
    });
    expect(tarde.estado).toBe('ejecutada');

    // Contratado y sin código: el moderador ya le da la palabra por su ficha.
    const siguiente = await publicarYModerar(
      montaje,
      '¿qué apuntes del banco quedan por conciliar?',
    );
    const turnos = (siguiente.decision as Extract<DecisionDelModerador, { tipo: 'intervenir' }>)
      .turnos;
    expect(turnos.map((t) => t.puestoId)).toEqual([contratado.puestoId]);

    // Y el Director no propone contratarlo otra vez.
    const repetida = await publicarYModerar(montaje, FRASE);
    const [otraPropuesta = '', otraRespuesta = ''] =
      await montaje.actividades.nuevosIdentificadores({
        cantidad: 2,
      });
    const segunda = await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId: repetida.mensajeId,
      personaId: montaje.semilla.personaId,
      texto: FRASE,
      propuestaId: otraPropuesta,
      respuestaId: otraRespuesta,
    });
    expect(segunda.propuestaId).toBeNull();
    expect((await mensajesDeLaSala(montaje)).find((m) => m.id === otraRespuesta)?.cuerpo).toContain(
      'ya tiene',
    );

    const contar = (accion: string) => contarEnElLibro(montaje.cliente, base.tenantId, { accion });
    expect(await contar(ACCIONES_SALA.propuestaCreada)).toBe(1);
    expect(await contar(ACCIONES_SALA.propuestaAprobada)).toBe(1);
    expect(await contar(ACCIONES_SALA.puestoContratado)).toBe(1);
    // Contratar no consume tareas del cupo.
    expect(await contar('tarea.contada')).toBe(0);
    expect((await verificarCadenaEnBase(montaje.cliente, base.tenantId)).valida).toBe(true);
  });

  it('una propuesta caducada se rechaza, avisa en la sala y ya no se ejecuta', async () => {
    const montaje = await preparar('Sala caducidad');
    const { mensajeId, base } = await publicarYModerar(montaje, FRASE);
    const [propuestaId = '', respuestaId = '', avisoId = ''] =
      await montaje.actividades.nuevosIdentificadores({ cantidad: 3 });
    await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: FRASE,
      propuestaId,
      respuestaId,
    });
    const caducada = await montaje.actividades.decidirPropuesta({
      ...base,
      propuestaId,
      sentido: 'caducada',
      personaId: null,
      avisoId,
    });
    expect(caducada.estado).toBe('rechazada');
    expect(
      await contarEnElLibro(montaje.cliente, base.tenantId, {
        accion: ACCIONES_SALA.propuestaCaducada,
      }),
    ).toBe(1);
    expect((await mensajesDeLaSala(montaje)).find((m) => m.id === avisoId)?.cuerpo).toContain(
      'caducó',
    );
    await expect(
      montaje.actividades.ejecutarContratacion({ ...base, propuestaId, presentacionId: uuidV7() }),
    ).rejects.toThrow(/solo se ejecuta una aprobada/);
  });

  it('una frase sin plantilla no crea propuesta y el Director lo explica', async () => {
    const montaje = await preparar('Sala aclaracion');
    const { mensajeId, base } = await publicarYModerar(montaje, 'contrata un agente de marketing');
    const [propuestaId = '', respuestaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    const resultado = await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: 'contrata un agente de marketing',
      propuestaId,
      respuestaId,
    });
    expect(resultado.propuestaId).toBeNull();
    expect(await propuesta(montaje, propuestaId)).toBeUndefined();
    expect((await mensajesDeLaSala(montaje)).at(-1)?.cuerpo).toContain('No encuentro');
  });

  /** La sala del departamento de Finanzas, con la persona y Cobros dentro. */
  async function salaDeDepartamento(montaje: MontajeDeSala) {
    const { tenantId, departamentoId, personaId, cobros } = montaje.semilla;
    return conTenant(montaje.cliente, tenantId, async (tx) => {
      const [sala] = await tx<{ id: string }[]>`
        insert into sala (tenant_id, departamento_id, ambito, nombre)
        values (${tenantId}, ${departamentoId}, 'departamento', 'Finanzas')
        returning id
      `;
      if (!sala) throw new Error('La sala del departamento no se insertó.');
      await tx`
        insert into sala_participante (tenant_id, sala_id, persona_id, rol)
        values (${tenantId}, ${sala.id}, ${personaId}, 'humano')
      `;
      await tx`
        insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
        values (${tenantId}, ${sala.id}, ${cobros.puestoId}, 'agente')
      `;
      return sala.id;
    });
  }

  /** Tarifa de los guiones del moderador y del Director: sin ella el paso de modelo cuesta 0. */
  async function conTarifaDeSala(montaje: MontajeDeSala) {
    const { tenantId } = montaje.semilla;
    const vigenteDesde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await conTenant(montaje.cliente, tenantId, async (tx) => {
      for (const modelo of [MODELO_PRUEBA_MODERADOR, MODELO_PRUEBA_DIRECTOR]) {
        // Una detrás de otra: dos anotaciones a la vez rompen la cadena del libro.
        await registrarTarifa(tx, tenantId, { ...TARIFA_DE_PRUEBA, modelo, vigenteDesde });
      }
    });
  }

  async function entradasDe(montaje: MontajeDeSala, accion: string) {
    return conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) =>
        tx<{ coste_euros: string; puesto_id: string | null }[]>`
        select coste_euros, puesto_id from entrada_auditoria
        where tenant_id = ${montaje.semilla.tenantId} and accion = ${accion}
        order by numero_orden
      `,
    );
  }

  async function notaDelModerador(montaje: MontajeDeSala, salaId: string, notaId: string) {
    const [fila] = await conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ adjuntos: { tipo: string; pasoDeModelo?: Record<string, unknown> }[] }[]>`
        select adjuntos from mensaje
        where tenant_id = ${montaje.semilla.tenantId} and sala_id = ${salaId} and id = ${notaId}
      `,
    );
    return fila?.adjuntos.find((a) => a.tipo === 'moderacion');
  }

  async function moderarEn(montaje: MontajeDeSala, salaId: string, texto: string) {
    const [mensajeId = '', notaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    const base = { tenantId: montaje.semilla.tenantId, salaId };
    await montaje.actividades.publicarMensajeHumano({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto,
    });
    const { decision } = await montaje.actividades.moderarMensaje({
      ...base,
      mensajeId,
      texto,
      notaId,
    });
    return { decision, mensajeId, notaId, base };
  }

  it('la sala general sigue sin modelo y con coste cero: el mensaje sin tema queda en silencio', async () => {
    const montaje = await preparar('Sala general sin modelo');
    await conTarifaDeSala(montaje);
    const { decision, notaId, base } = await moderarEn(
      montaje,
      montaje.semilla.salaId,
      PARAFRASIS_DE_COBROS,
    );
    expect(decision.tipo).toBe('silencio');
    expect((await notaDelModerador(montaje, base.salaId, notaId))?.pasoDeModelo).toEqual({
      usado: false,
      razon: 'sala_general',
    });
    const [entrada] = await entradasDe(montaje, ACCIONES_SALA.moderacionDecidida);
    expect(Number(entrada?.coste_euros)).toBe(0);
  });

  it('en la sala de un departamento una paráfrasis da la palabra a Cobros y el coste va al libro', async () => {
    const montaje = await preparar('Sala departamento moderador');
    await conTarifaDeSala(montaje);
    const salaId = await salaDeDepartamento(montaje);
    const tareasAntes = await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
      accion: ACCION_TAREA_CONTADA,
    });

    const { decision, notaId } = await moderarEn(montaje, salaId, PARAFRASIS_DE_COBROS);

    expect(decision.tipo).toBe('intervenir');
    expect(decision.tipo === 'intervenir' && decision.turnos.map((t) => t.puestoId)).toEqual([
      montaje.semilla.cobros.puestoId,
    ]);
    // El motivo del paso de modelo se distingue en el adjunto del moderador.
    expect((await notaDelModerador(montaje, salaId, notaId))?.pasoDeModelo).toMatchObject({
      usado: true,
      resultado: 'intervenir',
      llamadas: 1,
      version: 1,
    });
    // 1000 tokens de entrada y 100 de salida con la tarifa de prueba: 0,0045 €.
    const [entrada] = await entradasDe(montaje, ACCIONES_SALA.moderacionDecidida);
    expect(Number(entrada?.coste_euros)).toBeCloseTo(0.0045, 4);
    expect(entrada?.puesto_id).toBeNull();
    // Fuera del cupo del cliente: ni una tarea contada ni un uso de modelo de un puesto.
    expect(
      await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
        accion: ACCION_TAREA_CONTADA,
      }),
    ).toBe(tareasAntes);
    expect(
      await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
        accion: ACCION_USO_MODELO,
      }),
    ).toBe(0);
    expect((await verificarCadenaEnBase(montaje.cliente, montaje.semilla.tenantId)).valida).toBe(
      true,
    );
  });

  it('un reintento de la actividad devuelve la misma decisión sin volver a anotar el coste', async () => {
    const montaje = await preparar('Sala departamento reintento');
    await conTarifaDeSala(montaje);
    const salaId = await salaDeDepartamento(montaje);
    const { decision, mensajeId, notaId, base } = await moderarEn(
      montaje,
      salaId,
      PARAFRASIS_DE_COBROS,
    );
    const otra = await montaje.actividades.moderarMensaje({
      ...base,
      mensajeId,
      texto: PARAFRASIS_DE_COBROS,
      notaId,
    });
    expect(otra.yaEstaba).toBe(true);
    expect(otra.decision).toEqual(decision);
    expect((await entradasDe(montaje, ACCIONES_SALA.moderacionDecidida)).length).toBe(1);
  });

  it('sin tarifa, el proveedor de prueba no cobra: la demo local sigue siendo gratis', async () => {
    const montaje = await preparar('Sala departamento demo gratis');
    const salaId = await salaDeDepartamento(montaje);
    const { decision } = await moderarEn(montaje, salaId, PARAFRASIS_DE_COBROS);
    expect(decision.tipo).toBe('intervenir');
    const [entrada] = await entradasDe(montaje, ACCIONES_SALA.moderacionDecidida);
    expect(Number(entrada?.coste_euros)).toBe(0);
  });

  it('un modelo sin proveedor elegido no bloquea la sala: silencio con el motivo', async () => {
    const montaje = await preparar('Sala departamento sin proveedor');
    const salaId = await salaDeDepartamento(montaje);
    const enrutadorRoto = {
      resolverPaso: () => {
        throw new Error('sin proveedor de modelos');
      },
    };
    (montaje.contexto as { enrutador: unknown }).enrutador = enrutadorRoto;
    const { decision } = await moderarEn(montaje, salaId, PARAFRASIS_DE_COBROS);
    expect(decision.tipo).toBe('silencio');
    expect(decision.motivo).toContain('no estuvo disponible');
  });

  it('el Director entiende una contratación con otras palabras y la propuesta pasa por la política', async () => {
    const montaje = await preparar('Sala departamento director');
    await conTarifaDeSala(montaje);
    const salaId = await salaDeDepartamento(montaje);
    const moderado = await moderarEn(montaje, salaId, PARAFRASIS_DE_CONTRATAR);
    // El moderador de reglas no ve contratación; el paso de modelo la pasa al Director.
    expect(moderado.decision).toMatchObject({ tipo: 'operacion', operacion: 'contratar' });

    const [propuestaId = '', respuestaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    const resultado = await montaje.actividades.proponerOperacion({
      ...moderado.base,
      mensajeId: moderado.mensajeId,
      personaId: montaje.semilla.personaId,
      texto: PARAFRASIS_DE_CONTRATAR,
      propuestaId,
      respuestaId,
    });
    expect(resultado.propuestaId).toBe(propuestaId);
    const fila = await propuesta(montaje, propuestaId);
    expect(fila).toMatchObject({ tipo: 'contratar', estado: 'pendiente', nivel_exigido: 'n1' });

    const creadas = await entradasDe(montaje, ACCIONES_SALA.propuestaCreada);
    // 2000 tokens de entrada y 100 de salida: 0,0075 €, fuera de cualquier tarea de puesto.
    expect(Number(creadas[0]?.coste_euros)).toBeCloseTo(0.0075, 4);
    expect(
      await contarEnElLibro(montaje.cliente, montaje.semilla.tenantId, {
        accion: ACCION_USO_MODELO,
      }),
    ).toBe(0);
  });

  it('en la sala general la frase parafraseada sigue sin plantilla: aclaración y coste cero', async () => {
    const montaje = await preparar('Sala general director sin modelo');
    await conTarifaDeSala(montaje);
    const { mensajeId, base } = await publicarYModerar(montaje, PARAFRASIS_DE_CONTRATAR);
    const [propuestaId = '', respuestaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    const resultado = await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: PARAFRASIS_DE_CONTRATAR,
      propuestaId,
      respuestaId,
    });
    expect(resultado.propuestaId).toBeNull();
    expect((await mensajesDeLaSala(montaje)).at(-1)?.cuerpo).toContain('No encuentro');
    const [entrada] = await entradasDe(montaje, ACCIONES_SALA.respuestaPublicada);
    expect(Number(entrada?.coste_euros)).toBe(0);
  });

  it('ninguna credencial de modelo aparece en el prompt, el mensaje ni el libro del paso de modelo', async () => {
    const montaje = await preparar('Sala departamento secretos');
    await conTarifaDeSala(montaje);
    const salaId = await salaDeDepartamento(montaje);
    await moderarEn(montaje, salaId, PARAFRASIS_DE_COBROS);
    const volcado = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
      const filas = await tx<{ t: string }[]>`
        select row_to_json(m)::text as t from mensaje m where m.tenant_id = ${montaje.semilla.tenantId}
        union all
        select row_to_json(e)::text from entrada_auditoria e where e.tenant_id = ${montaje.semilla.tenantId}
      `;
      return filas.map((f) => f.t).join('\n');
    });
    expect(volcado).not.toContain(SECRETO_DE_PRUEBA);
    for (const traza of montaje.trazas.trazas) {
      expect(JSON.stringify(traza)).not.toContain(SECRETO_DE_PRUEBA);
    }
  });

  it('un mensaje vacío o de una persona de otra organización no se publica', async () => {
    const montaje = await preparar('Sala validacion');
    const base = { tenantId: montaje.semilla.tenantId, salaId: montaje.semilla.salaId };
    await expect(
      montaje.actividades.publicarMensajeHumano({
        ...base,
        mensajeId: uuidV7(),
        personaId: montaje.semilla.personaId,
        texto: '   ',
      }),
    ).rejects.toThrow(/vacío/);
    await expect(
      montaje.actividades.publicarMensajeHumano({
        ...base,
        mensajeId: uuidV7(),
        personaId: uuidV7(),
        texto: PREGUNTA,
      }),
    ).rejects.toThrow(/no está activa/);
  });

  it('ningún mensaje, propuesta ni entrada del libro lleva el secreto del conector', async () => {
    const montaje = await preparar('Sala secretos');
    const { mensajeId, base } = await publicarYModerar(montaje, FRASE);
    const [propuestaId = '', respuestaId = ''] = await montaje.actividades.nuevosIdentificadores({
      cantidad: 2,
    });
    await montaje.actividades.proponerOperacion({
      ...base,
      mensajeId,
      personaId: montaje.semilla.personaId,
      texto: FRASE,
      propuestaId,
      respuestaId,
    });
    const volcado = await conTenant(montaje.cliente, base.tenantId, async (tx) => {
      const filas = await tx<{ t: string }[]>`
        select row_to_json(m)::text as t from mensaje m where m.tenant_id = ${base.tenantId}
        union all
        select row_to_json(p)::text from propuesta_operacion p where p.tenant_id = ${base.tenantId}
        union all
        select row_to_json(e)::text from entrada_auditoria e where e.tenant_id = ${base.tenantId}
      `;
      return filas.map((f) => f.t).join('\n');
    });
    expect(volcado.length).toBeGreaterThan(100);
    expect(volcado).not.toContain(SECRETO_DE_PRUEBA);
  });
});

let entorno: TestWorkflowEnvironment | null = null;
let motivoSalto = HAY_BASE_DE_DATOS ? '' : MOTIVO_SALTO;

describe('sala v0 · flujos con servidor de Temporal', () => {
  const montajes: MontajeDeSala[] = [];
  beforeAll(async () => {
    if (!HAY_BASE_DE_DATOS) return;
    const arrancado = await arrancarEntorno('local');
    entorno = arrancado.entorno;
    motivoSalto = arrancado.motivoSalto;
  }, 300_000);
  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((m) => m.cerrar()));
  }, 60_000);
  afterAll(async () => {
    await entorno?.teardown();
  }, 60_000);

  it('pregunta y contratación de punta a punta, con el clic como señal', async (ctx) => {
    if (!entorno) return ctx.skip(motivoSalto);
    const montaje = await montarSalaParaPruebas(`Sala flujos ${uuidV7()}`);
    montajes.push(montaje);
    const cola = `sala-${montaje.semilla.tenantId}`;
    const trabajador = await Worker.create({
      connection: entorno.nativeConnection,
      namespace: entorno.client.options.namespace,
      taskQueue: cola,
      workflowsPath: RUTA_FLUJOS,
      activities: crearActividades(montaje.contexto),
      stickyQueueScheduleToStartTimeout: '1 second',
      shutdownGraceTime: '1 second',
    });
    const cliente = entorno.client;
    const base = {
      tenantId: montaje.semilla.tenantId,
      salaId: montaje.semilla.salaId,
      personaId: montaje.semilla.personaId,
    };

    await trabajador.runUntil(async () => {
      const preguntaId = uuidV7();
      const pregunta = await cliente.workflow.execute(mensajeDeSala, {
        taskQueue: cola,
        workflowId: idFlujoMensaje(preguntaId),
        args: [{ ...base, mensajeId: preguntaId, texto: PREGUNTA }],
      });
      expect(pregunta.decision).toBe('intervenir');
      expect(pregunta.intervenciones).toEqual([
        expect.objectContaining({
          puestoId: montaje.semilla.cobros.puestoId,
          estado: 'completada',
        }),
      ]);

      const fraseId = uuidV7();
      const frase = await cliente.workflow.execute(mensajeDeSala, {
        taskQueue: cola,
        workflowId: idFlujoMensaje(fraseId),
        args: [{ ...base, mensajeId: fraseId, texto: FRASE }],
      });
      expect(frase.decision).toBe('operacion');
      expect(frase.propuestaId).not.toBeNull();

      const mango = cliente.workflow.getHandle(idFlujoPropuesta(frase.propuestaId ?? ''));
      // Un clic de alguien que no existe no cierra la propuesta; el bueno, sí.
      await mango.signal(decisionDePropuesta, { personaId: uuidV7(), sentido: 'aprobada' });
      await mango.signal(decisionDePropuesta, { personaId: base.personaId, sentido: 'aprobada' });
      const resultado = (await mango.result()) as { estado: string; puestoId: string | null };
      expect(resultado.estado).toBe('ejecutada');
      expect(resultado.puestoId).not.toBeNull();
    });

    const contar = (accion: string) => contarEnElLibro(montaje.cliente, base.tenantId, { accion });
    expect(await contar('tarea.contada')).toBe(1);
    expect(await contar(ACCIONES_SALA.puestoContratado)).toBe(1);
    expect((await verificarCadenaEnBase(montaje.cliente, base.tenantId)).valida).toBe(true);
  }, 120_000);
});
