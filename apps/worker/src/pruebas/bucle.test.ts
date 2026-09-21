/**
 * El bucle del agente contra la base real, el libro real y un servidor MCP real.
 *
 * Estas pruebas no necesitan Temporal: llaman a las mismas actividades que el flujo
 * y le dan al bucle una espera de decisión que resuelve al momento. Lo que
 * comprueban es la tabla de políticas en ejecución, la parada por presupuesto, la
 * auditoría, el contador y la proyección del estado.
 *
 * Lo que sí necesita Temporal —durabilidad, reanudación tras caída, flujo hijo con
 * plazo vencido y espera de señal— está en `flujos.test.ts`.
 */
import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, PUESTO_CONCILIACION } from '@aiw/db/pruebas';
import { HERRAMIENTA_NOTA } from '@aiw/connector-demo';
import { leerCadena, verificarCadenaEnBase } from '@aiw/ledger';
import { afterEach, describe, expect, it } from 'vitest';

import { ejecutarBucle, type OperacionesDelBucle } from '../bucle/bucle.js';
import type { DecisionRecibida, EntradaTareaAgente, ResultadoTareaAgente } from '../bucle/tipos.js';
import { leerPasos, leerTarea, montarParaPruebas, type MontajeDePruebas } from './montaje.js';

const ENCARGO = 'Haz el seguimiento de cobros de hoy y deja una nota por cada factura vencida.';

/** Cómo decide la persona en cada prueba, por orden de aprobación pedida. */
type Decisor = (aprobacionId: string, indice: number) => DecisionRecibida;

const apruebaTodo: Decisor = (aprobacionId) => ({
  aprobacionId,
  sentido: 'aprobada',
  personaId: null,
});

describe.skipIf(!HAY_BASE_DE_DATOS)('bucle del agente · contra la base y el libro', () => {
  const montajes: MontajeDePruebas[] = [];

  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((montaje) => montaje.cerrar()));
  });

  async function correr(opciones: {
    nombre: string;
    decisor?: Decisor | undefined;
    presupuestoTareaEuros?: number | undefined;
    fallosIniciales?: number | undefined;
    puesto?: 'cobros' | 'conciliacion' | undefined;
    entrada?: Partial<EntradaTareaAgente> | undefined;
  }): Promise<{
    montaje: MontajeDePruebas;
    resultado: ResultadoTareaAgente;
    aprobaciones: string[];
  }> {
    const montaje = await montarParaPruebas({
      nombre: opciones.nombre,
      ...(opciones.presupuestoTareaEuros === undefined
        ? {}
        : { presupuestoTareaEuros: opciones.presupuestoTareaEuros }),
      ...(opciones.fallosIniciales === undefined
        ? {}
        : { fallosIniciales: opciones.fallosIniciales }),
    });
    montajes.push(montaje);

    const puesto =
      opciones.puesto === 'conciliacion' ? montaje.semilla.conciliacion : montaje.semilla.cobros;
    const identidad = {
      tenantId: montaje.semilla.tenantId,
      puestoId: puesto.puestoId,
      versionPuestoId: puesto.versionPuestoId,
      tareaId: montaje.tareaId,
    };

    // La tarea se sembró para Cobros; si la prueba usa Conciliación, se cambia el
    // puesto de la fila para que la política que se aplica sea la del puesto en prueba.
    if (opciones.puesto === 'conciliacion') {
      await conTenant(
        montaje.cliente,
        identidad.tenantId,
        (tx) => tx`
        update tarea set puesto_id = ${puesto.puestoId}, version_puesto_id = ${puesto.versionPuestoId}
        where tenant_id = ${identidad.tenantId} and id = ${montaje.tareaId}
      `,
      );
    }

    const aprobaciones: string[] = [];
    const decisor = opciones.decisor ?? apruebaTodo;
    const actividades = montaje.actividades;

    await actividades.arrancarTarea({
      ...identidad,
      flujoTemporalId: `prueba-${montaje.tareaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });

    const operaciones: OperacionesDelBucle = {
      leerContexto: () => actividades.leerContexto(identidad),
      pasoModelo: (peticion) => actividades.pasoModelo(peticion),
      pasoHerramienta: (peticion) => actividades.pasoHerramienta(peticion),
      async pedirAprobacion(peticion) {
        const creada = await actividades.pedirAprobacion(peticion);
        aprobaciones.push(creada.aprobacionId);
        return creada;
      },
      esperarDecision: (aprobacionId) =>
        Promise.resolve(decisor(aprobacionId, aprobaciones.length - 1)),
      anotarPaso: (peticion) => actividades.anotarPaso(peticion),
      senalDeAprendizaje: (peticion) => actividades.senalDeAprendizaje(peticion),
    };

    const resultado = await ejecutarBucle(operaciones, {
      ...identidad,
      encargo: ENCARGO,
      ...(opciones.entrada ?? {}),
    });
    await actividades.proyectarEstado({
      tenantId: identidad.tenantId,
      tareaId: identidad.tareaId,
      estado: resultado.estado,
      resultado: { ...resultado },
    });

    return { montaje, resultado, aprobaciones };
  }

  it('lee, pide tres aprobaciones y escribe las tres notas', async () => {
    const { montaje, resultado, aprobaciones } = await correr({
      nombre: `Bucle completo ${Date.now()}`,
      presupuestoTareaEuros: 1,
    });

    expect(aprobaciones).toHaveLength(3);
    expect(resultado.estado).toBe('completada');
    expect(resultado.escriturasEjecutadas).toBe(3);
    expect(resultado.escriturasSaltadas).toBe(0);
    expect(resultado.resumen).toContain('Seguimiento de cobros hecho');

    const tarea = await leerTarea(montaje.cliente, montaje.semilla.tenantId, montaje.tareaId);
    expect(tarea.estado).toBe('completada');
    expect(tarea.coste).toBeGreaterThan(0);
  });

  it('una aprobación rechazada salta la escritura y emite señal de aprendizaje', async () => {
    const { montaje, resultado } = await correr({
      nombre: `Bucle rechazo ${Date.now()}`,
      decisor: (aprobacionId, indice) =>
        indice === 0
          ? { aprobacionId, sentido: 'rechazada', personaId: null, motivo: 'Ya nos pagó ayer.' }
          : apruebaTodo(aprobacionId, indice),
    });

    expect(resultado.escriturasSaltadas).toBe(1);
    expect(resultado.escriturasEjecutadas).toBe(2);

    const senales = await conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ tipo: string; contenido: { puntuacion?: number } }[]>`
      select tipo, contenido from senal
      where tenant_id = ${montaje.semilla.tenantId} and tarea_id = ${montaje.tareaId}
      order by creado_en asc
    `,
    );
    const rechazo = senales.find((senal) => (senal.contenido.puntuacion ?? 0) === -1);
    expect(rechazo?.tipo).toBe('aprobacion');
  });

  it('una aprobación editada ejecuta el borrador corregido y guarda la corrección', async () => {
    const { montaje, resultado } = await correr({
      nombre: `Bucle edicion ${Date.now()}`,
      decisor: (aprobacionId, indice) =>
        indice === 0
          ? {
              aprobacionId,
              sentido: 'editada',
              personaId: null,
              argumentosEditados: {
                factura_id: 'inv-0001',
                texto: 'Hola. Te llamamos mañana para hablar del pago de la F-2026-0001.',
              },
            }
          : apruebaTodo(aprobacionId, indice),
    });

    expect(resultado.escriturasEjecutadas).toBe(3);

    const correccion = await conTenant(
      montaje.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ contenido: { detalle?: { despues?: { texto?: string } } } }[]>`
      select contenido from senal
      where tenant_id = ${montaje.semilla.tenantId} and tipo = 'correccion'
    `,
    );
    expect(correccion[0]?.contenido.detalle?.despues?.texto).toContain('Te llamamos mañana');
  });

  it('un puesto en prueba simula las escrituras y no toca el conector', async () => {
    const { resultado } = await correr({
      nombre: `Bucle en prueba ${Date.now()}`,
      puesto: 'conciliacion',
    });

    expect(resultado.escriturasSimuladas).toBe(3);
    expect(resultado.escriturasEjecutadas).toBe(0);
    expect(resultado.estado).toBe('completada');
  });

  it('el presupuesto agotado detiene el bucle y pide la ampliación', async () => {
    const { montaje, resultado, aprobaciones } = await correr({
      nombre: `Bucle presupuesto ${Date.now()}`,
      // Alcanza para el primer paso de modelo y no para el segundo: la parada llega
      // cuando el bucle ya ha hecho algo, que es el caso que importa.
      presupuestoTareaEuros: 0.003,
    });

    expect(resultado.estado).toBe('esperando_aprobacion');
    expect(resultado.motivo).toContain('ampliación');

    const tarea = await leerTarea(montaje.cliente, montaje.semilla.tenantId, montaje.tareaId);
    expect(tarea.estado).toBe('esperando_aprobacion');

    const ultima = aprobaciones[aprobaciones.length - 1] ?? '';
    const clases = await conTenant(montaje.cliente, montaje.semilla.tenantId, async (tx) => {
      const filas = await tx<{ clase_accion: string; nivel_exigido: string }[]>`
        select clase_accion, nivel_exigido from aprobacion
        where tenant_id = ${montaje.semilla.tenantId} and id = ${ultima}
      `;
      return [...filas];
    });
    expect(clases[0]?.clase_accion).toBe('presupuesto.ampliacion');
  });

  it('cada paso deja fila y entrada, el contador cuadra y la cadena verifica', async () => {
    const { montaje } = await correr({ nombre: `Bucle auditoria ${Date.now()}` });
    const tenantId = montaje.semilla.tenantId;

    const pasos = await leerPasos(montaje.cliente, tenantId, montaje.tareaId);
    expect(pasos.length).toBeGreaterThanOrEqual(8);
    // Los números de paso son consecutivos y sin huecos: son la clave de idempotencia.
    expect(pasos.map((paso) => paso.numero)).toEqual(pasos.map((_, indice) => indice + 1));

    const cadena = await conTenant(montaje.cliente, tenantId, (tx) => leerCadena(tx, tenantId));
    expect(cadena.filter((entrada) => entrada.accion === 'tarea.contada')).toHaveLength(1);
    expect(
      cadena.filter(
        (entrada) => entrada.accion === 'herramienta.llamada' && entrada.resultado === 'exito',
      ).length,
    ).toBeGreaterThanOrEqual(4);
    expect(cadena.filter((entrada) => entrada.accion === 'modelo.uso').length).toBeGreaterThan(0);

    const [contador] = await conTenant(
      montaje.cliente,
      tenantId,
      (tx) => tx<{ tareas: string; acciones: string; coste_euros: string }[]>`
      select tareas, acciones, coste_euros from contador_consumo
      where tenant_id = ${tenantId}
    `,
    );
    // El contador cuenta una acción por entrada del libro: son la misma escritura.
    expect(Number(contador?.acciones)).toBe(cadena.length);
    expect(Number(contador?.tareas)).toBe(1);

    const sumaDelLibro = cadena.reduce((suma, entrada) => suma + entrada.costeEuros, 0);
    expect(Number(contador?.coste_euros)).toBeCloseTo(sumaDelLibro, 4);

    const verificacion = await conTenant(montaje.cliente, tenantId, (tx) =>
      verificarCadenaEnBase(tx, tenantId),
    );
    expect(verificacion.valida).toBe(true);
  });

  it('el fallo del conector se propaga con el motivo para que Temporal reintente', async () => {
    // Un solo fallo y ningún reintento en esta prueba: se comprueba que el error
    // sube con el nombre de la herramienta, que es lo que la actividad necesita para
    // que el reintento de Temporal tenga sentido.
    const fallo = await correr({
      nombre: `Bucle fallo ${Date.now()}`,
      fallosIniciales: 1,
    }).catch((error: unknown) => error);

    expect(String(fallo)).toContain('listar_facturas_vencidas');
  });

  it('cada paso de herramienta anota la herramienta y el nivel aplicado', async () => {
    const { montaje } = await correr({ nombre: `Bucle niveles ${Date.now()}` });
    const tenantId = montaje.semilla.tenantId;

    const cadena = await conTenant(montaje.cliente, tenantId, (tx) => leerCadena(tx, tenantId));
    const escrituras = cadena.filter(
      (entrada) =>
        entrada.herramienta === HERRAMIENTA_NOTA && entrada.accion === 'herramienta.llamada',
    );
    expect(escrituras).toHaveLength(3);
    for (const entrada of escrituras) {
      expect(entrada.nivelAplicado).toBe('n1');
      expect(entrada.versionPuestoId).toBe(montaje.semilla.cobros.versionPuestoId);
      expect(entrada.datosReferenciados.some((dato) => dato.tipo === 'aprobacion')).toBe(true);
    }
  });

  it('el valor del secreto no aparece en las trazas ni en el libro ni en los pasos', async () => {
    const { montaje } = await correr({ nombre: `Bucle secretos ${Date.now()}` });
    const tenantId = montaje.semilla.tenantId;

    const cadena = await conTenant(montaje.cliente, tenantId, (tx) => leerCadena(tx, tenantId));
    const pasos = await conTenant(
      montaje.cliente,
      tenantId,
      (tx) =>
        tx<
          { entrada: unknown; salida: unknown }[]
        >`select entrada, salida from paso where tenant_id = ${tenantId}`,
    );

    const todo = JSON.stringify({ trazas: montaje.trazas.trazas, cadena, pasos });
    const { SECRETO_DE_PRUEBA } = await import('./montaje.js');
    expect(todo).not.toContain(SECRETO_DE_PRUEBA);
    expect(montaje.trazas.trazas.length).toBeGreaterThan(0);
    // Y la traza sí lleva los cuatro identificadores con los que se busca.
    expect(montaje.trazas.ultima).toMatchObject({
      tenantId,
      tareaId: montaje.tareaId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
    });
  });

  it('una tarea hija no suma otra unidad al contador: cuenta dentro de su raíz', async () => {
    const montaje = await montarParaPruebas({ nombre: `Bucle hija ${Date.now()}` });
    montajes.push(montaje);
    const tenantId = montaje.semilla.tenantId;

    await montaje.actividades.arrancarTarea({
      tenantId,
      tareaId: montaje.tareaId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      flujoTemporalId: `prueba-${montaje.tareaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });

    // Una tarea que cuelga de la raíz, como la que abre una delegación.
    const hijaId = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const [hija] = await tx<{ id: string }[]>`
        insert into tarea (
          tenant_id, tarea_raiz_id, tarea_padre_id, puesto_id, version_puesto_id,
          origen, estado, presupuesto_euros
        ) values (
          ${tenantId}, ${montaje.tareaId}, ${montaje.tareaId},
          ${montaje.semilla.conciliacion.puestoId},
          ${montaje.semilla.conciliacion.versionPuestoId},
          'delegacion', 'pendiente', 0.2
        )
        returning id
      `;
      if (!hija) throw new Error('No se creó la tarea hija.');
      return hija.id;
    });

    const arrancada = await montaje.actividades.arrancarTarea({
      tenantId,
      tareaId: hijaId,
      puestoId: montaje.semilla.conciliacion.puestoId,
      versionPuestoId: montaje.semilla.conciliacion.versionPuestoId,
      flujoTemporalId: `prueba-hija-${hijaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });

    // No cuenta, y no falla: arrancar un hijo es normal, y llamar a
    // `registrarTareaRaiz` con él sería un error que se reintentaría en bucle.
    expect(arrancada.conto).toBe(false);

    const [contador] = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<{ tareas: string }[]>`
        select tareas from contador_consumo where tenant_id = ${tenantId}
      `;
      return [...filas];
    });
    expect(Number(contador?.tareas)).toBe(1);

    // Pero su arranque sí queda en el libro, con el padre referenciado.
    const cadena = await conTenant(montaje.cliente, tenantId, (tx) => leerCadena(tx, tenantId));
    const arranque = cadena.find((entrada) => entrada.accion === 'tarea.arrancada');
    expect(arranque?.tareaId).toBe(hijaId);
    expect(arranque?.datosReferenciados).toEqual(
      expect.arrayContaining([{ tipo: 'tarea_padre', id: montaje.tareaId }]),
    );
  });

  it('la delegación se abre con el presupuesto acotado al restante del padre', async () => {
    const montaje = await montarParaPruebas({
      nombre: `Bucle cota ${Date.now()}`,
      presupuestoTareaEuros: 0.5,
    });
    montajes.push(montaje);
    const tenantId = montaje.semilla.tenantId;
    const identidad = {
      tenantId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      tareaId: montaje.tareaId,
    };
    await montaje.actividades.arrancarTarea({
      ...identidad,
      flujoTemporalId: `prueba-${montaje.tareaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });

    const contrato = {
      encargo: 'Concilia la factura F-2026-0001 con el extracto bancario.',
      plazoSegundos: 120,
      // Más de lo que le queda al padre: 0,5 € y nada gastado todavía.
      presupuestoEuros: 2,
      formato: { formato: 'json' as const, criteriosAceptacion: ['Indica el asiento propuesto'] },
      caducidadSegundos: 600,
      politicaRespaldo: 'seguir_sin_ello' as const,
    };

    const abierta = await montaje.actividades.abrirDelegacion({
      ...identidad,
      puestoDestinoNombre: PUESTO_CONCILIACION,
      contrato,
    });
    expect(abierta.yaEstaba).toBe(false);
    expect(abierta.presupuestoEuros).toBe(0.5);

    // Lo acotado es lo que queda escrito: es lo que leerá el bucle del hijo.
    const escrito = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const [hija] = await tx<{ presupuesto_euros: string }[]>`
        select presupuesto_euros from tarea
        where tenant_id = ${tenantId} and id = ${abierta.tareaDestinoId}
      `;
      const [delegacion] = await tx<{ presupuesto_euros: string }[]>`
        select presupuesto_euros from delegacion
        where tenant_id = ${tenantId} and id = ${abierta.delegacionId}
      `;
      return {
        hija: Number(hija?.presupuesto_euros),
        delegacion: Number(delegacion?.presupuesto_euros),
      };
    });
    expect(escrito).toEqual({ hija: 0.5, delegacion: 0.5 });

    // El libro dice lo que se concedió y lo que se pidió.
    const cadena = await conTenant(montaje.cliente, tenantId, (tx) => leerCadena(tx, tenantId));
    const apertura = cadena.find((entrada) => entrada.accion === 'delegacion.abierta');
    expect(apertura?.datosReferenciados).toEqual(
      expect.arrayContaining([
        { tipo: 'presupuesto_euros', id: '0.5' },
        { tipo: 'presupuesto_pedido_euros', id: '2' },
      ]),
    );

    // Reabrir la misma delegación devuelve el mismo presupuesto acotado.
    const repetida = await montaje.actividades.abrirDelegacion({
      ...identidad,
      puestoDestinoNombre: PUESTO_CONCILIACION,
      contrato,
    });
    expect(repetida.yaEstaba).toBe(true);
    expect(repetida.presupuestoEuros).toBe(0.5);
  });

  it('vencer una aprobación ya caducada la resuelve la plataforma como `aprobacion.vencida`', async () => {
    const montaje = await montarParaPruebas({ nombre: `Bucle vencimiento ${Date.now()}` });
    montajes.push(montaje);
    const tenantId = montaje.semilla.tenantId;
    const identidad = {
      tenantId,
      puestoId: montaje.semilla.cobros.puestoId,
      versionPuestoId: montaje.semilla.cobros.versionPuestoId,
      tareaId: montaje.tareaId,
    };
    await montaje.actividades.arrancarTarea({
      ...identidad,
      flujoTemporalId: `prueba-${montaje.tareaId}`,
      ejecucionTemporalId: 'sin-temporal',
    });
    const pedir = (numeroPaso: number, validezSegundos: number) =>
      montaje.actividades.pedirAprobacion({
        ...identidad,
        claseAccion: 'escritura',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'nota_seguimiento', carga: { factura_id: 'F-2026-0001' } },
        resumenLegible: 'Nota de seguimiento a la factura F-2026-0001',
        numeroPaso,
        validezSegundos,
      });

    // Ya vencida cuando el flujo la vence: es lo que pasa tras esperar la validez.
    const caducada = await pedir(1, 0);
    const vencida = await montaje.actividades.vencerAprobacion({
      tenantId,
      aprobacionId: caducada.aprobacionId,
      motivo: 'Vencida sin respuesta durante la ejecución del flujo',
    });
    expect(vencida).toMatchObject({ sentido: 'rechazada', personaId: null });

    // Todavía viva: es el flujo hijo, que no espera decisiones humanas.
    const viva = await pedir(2, 120);
    const rechazada = await montaje.actividades.vencerAprobacion({
      tenantId,
      aprobacionId: viva.aprobacionId,
      motivo: 'Un flujo hijo no espera decisiones humanas: el padre tiene su plazo',
    });
    expect(rechazada).toMatchObject({ sentido: 'rechazada', personaId: null });

    // Vencerla otra vez no cambia nada y sigue diciendo lo mismo.
    const repetida = await montaje.actividades.vencerAprobacion({
      tenantId,
      aprobacionId: caducada.aprobacionId,
      motivo: 'Vencida sin respuesta durante la ejecución del flujo',
    });
    expect(repetida).toMatchObject({ sentido: 'rechazada', personaId: null });

    const entradas = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<{ accion: string; herramienta: string | null }[]>`
        select accion, herramienta from entrada_auditoria
        where tenant_id = ${tenantId} and accion like 'aprobacion.%'
        order by numero_orden asc
      `;
      return [...filas].map(
        (fila) => `${fila.accion}${fila.herramienta ? `@${fila.herramienta}` : ''}`,
      );
    });
    expect(entradas).toEqual([
      'aprobacion.solicitada',
      'aprobacion.vencida',
      'aprobacion.solicitada',
      'aprobacion.rechazada@temporal',
    ]);

    const decisiones = await conTenant(montaje.cliente, tenantId, async (tx) => {
      const filas = await tx<{ persona_id: string | null; motivo: string | null }[]>`
        select persona_id, motivo from decision_aprobacion where tenant_id = ${tenantId}
      `;
      return [...filas];
    });
    expect(decisiones).toHaveLength(2);
    expect(decisiones.every((decision) => decision.persona_id === null)).toBe(true);
  });

  it('un guardia de salida tapa lo que tenga forma de credencial', async () => {
    const { crearGuardias, revisarTodo, REDACTADO } = await import('../bucle/guardias.js');
    const guardias = crearGuardias(['sin_secretos']);
    const revisado = revisarTodo(
      guardias,
      'Conéctate con postgresql://usuario:contrasenamuylarga@host/base y usa sk-abcdefghijklmnopqrst.',
    );

    expect(revisado.pasa).toBe(false);
    expect(revisado.texto).not.toContain('contrasenamuylarga');
    expect(revisado.texto).not.toContain('sk-abcdefghijklmnopqrst');
    expect(revisado.texto).toContain(REDACTADO);
    expect(revisado.hallazgos).toHaveLength(2);
  });

  it('un nombre de política desconocido no se ignora: queda como guardia nulo', async () => {
    const { crearGuardias } = await import('../bucle/guardias.js');
    const guardias = crearGuardias(['sin_datos_personales']);
    expect(guardias[0]?.nombre).toBe('nulo:sin_datos_personales');
    expect(guardias[0]?.revisar('cualquier cosa').pasa).toBe(true);
  });
});

if (!HAY_BASE_DE_DATOS) {
  console.warn(`[bucle] ${MOTIVO_SALTO}`);
}
