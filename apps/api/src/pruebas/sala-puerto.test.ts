/**
 * El puerto real de la sala contra PostgreSQL, con el rol de aplicación y RLS.
 *
 * Los flujos son falsos: aquí se prueba que las lecturas devuelven lo que pinta la
 * sala —autores, adjuntos sin la decisión interna del moderador, propuestas— y que
 * no ven nada de otra organización. Que las escrituras las hace el trabajador lo
 * prueban `apps/worker` y las pruebas de la ruta.
 */
import { ROL_APLICACION, aplicarMigraciones, conTenant, crearConexion, uuidV7 } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  conectar,
  sembrarFinanzas,
} from '@aiw/db/pruebas';
import { NOMBRE_SALA_GENERAL } from '@aiw/rooms';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { puertoSala, type ClienteDeFlujos, type ConfiguracionSala } from '../rutas/sala';

const TITULO = HAY_BASE_DE_DATOS
  ? 'puerto de la sala'
  : `puerto de la sala — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let conexion: ReturnType<typeof crearConexion>;
  const arrancados: { nombre: string; id: string; cola: string }[] = [];
  const senales: { id: string; senal: string }[] = [];
  const flujos: ClienteDeFlujos = {
    arrancar: (nombre, opciones) => {
      arrancados.push({ nombre, id: opciones.id, cola: opciones.cola });
      return Promise.resolve();
    },
    senalar: (id, senal) => {
      senales.push({ id, senal });
      return Promise.resolve();
    },
  };
  const configuracion = {
    token: uuidV7(),
    temporal: { direccion: 'localhost:7233', espacio: 'default', cola: 'cola-de-la-sala' },
  } satisfies ConfiguracionSala;
  let tenantId = '';
  let personaId = '';
  let salaId = '';
  const propuestaId = uuidV7();

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    const sembrado = await sembrarFinanzas(cliente, {
      nombre: `Sala puerto ${uuidV7()}`,
      conector: 'demo-cobros',
      referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
      listaBlanca: ['listar_facturas_vencidas'],
      soloCobros: true,
    });
    tenantId = sembrado.tenantId;
    personaId = sembrado.personaId;
    // Cada mensaje con su hora: en una sola transacción `now()` es la misma para
    // todos y el orden por identificador no está garantizado.
    salaId = await conTenant(cliente, tenantId, async (tx) => {
      const [sala] = await tx<{ id: string }[]>`
        insert into sala (tenant_id, ambito, nombre)
        values (${tenantId}, 'organizacion', ${NOMBRE_SALA_GENERAL}) returning id
      `;
      const id = sala?.id ?? '';
      await tx`
        insert into propuesta_operacion (id, tenant_id, tipo, actor_tipo, resumen, nivel_exigido, estado)
        values (${propuestaId}, ${tenantId}, 'contratar', 'plataforma', 'Contratar Conciliación bancaria', 'n1', 'pendiente')
      `;
      await tx`
        insert into mensaje (tenant_id, sala_id, autor_persona_id, cuerpo, creado_en)
        values (${tenantId}, ${id}, ${personaId}, '¿cómo vamos de cobros?',
          now() + interval '1 second')
      `;
      await tx`
        insert into mensaje (tenant_id, sala_id, cuerpo, adjuntos, creado_en)
        values (${tenantId}, ${id}, 'Da la palabra a Cobros.',
          ${JSON.stringify([
            { tipo: 'autor_plataforma', agente: 'moderador' },
            {
              tipo: 'moderacion',
              decision: 'intervenir',
              puestos: [],
              motivo: 'm',
              decisionCompleta: { tipo: 'intervenir' },
            },
          ])}::text::jsonb,
          now() + interval '2 second')
      `;
      await tx`
        insert into mensaje (tenant_id, sala_id, autor_puesto_id, cuerpo, creado_en)
        values (${tenantId}, ${id}, ${sembrado.cobros.puestoId}, 'Este mes hay 3 facturas vencidas.',
          now() + interval '3 second')
      `;
      await tx`
        insert into mensaje (tenant_id, sala_id, cuerpo, adjuntos, creado_en)
        values (${tenantId}, ${id}, 'Propongo contratar Conciliación bancaria.',
          ${JSON.stringify([
            { tipo: 'autor_plataforma', agente: 'director_ia' },
            { tipo: 'propuesta_operacion', propuestaId },
          ])}::text::jsonb,
          now() + interval '4 second')
      `;
      return id;
    });
    conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '', rolAplicacion: ROL_APLICACION });
  });

  afterAll(async () => {
    await conexion?.cerrar();
    await cliente?.end({ timeout: 5 });
  });

  it('lee la sala general, sus autores y sus propuestas', async () => {
    const puerto = puertoSala(conexion.cliente, flujos, configuracion);
    expect(await puerto.salaGeneral(tenantId)).toBe(salaId);
    expect(await puerto.personaActiva(tenantId, personaId)).toBe(true);
    expect(await puerto.personaActiva(tenantId, uuidV7())).toBe(false);

    const mensajes = await puerto.mensajes(tenantId, salaId, 100);
    expect(mensajes.map((m) => m.autor)).toEqual([
      { tipo: 'persona', nombre: 'Jesús' },
      { tipo: 'plataforma', nombre: 'Moderador' },
      { tipo: 'puesto', nombre: 'Cobros' },
      { tipo: 'plataforma', nombre: 'Director de IA' },
    ]);
    expect(JSON.stringify(mensajes)).not.toContain('decisionCompleta');
    expect((await puerto.mensajes(tenantId, salaId, 2)).map((m) => m.autor.nombre)).toEqual([
      'Cobros',
      'Director de IA',
    ]);

    const [propuesta] = await puerto.propuestas(tenantId, [propuestaId]);
    expect(propuesta).toMatchObject({ id: propuestaId, estado: 'pendiente', nivelExigido: 'n1' });
    expect(await puerto.propuestas(tenantId, [])).toEqual([]);
  });

  it('otra organización no ve la sala ni la propuesta', async () => {
    const puerto = puertoSala(conexion.cliente, flujos, configuracion);
    const otra = uuidV7();
    expect(await puerto.salaGeneral(otra)).toBeNull();
    expect(await puerto.mensajes(otra, salaId, 100)).toEqual([]);
    expect(await puerto.propuestas(otra, [propuestaId])).toEqual([]);
  });

  it('escribir y decidir van a Temporal por nombre y en la cola configurada', async () => {
    const puerto = puertoSala(conexion.cliente, flujos, configuracion);
    const mensajeId = uuidV7();
    await puerto.arrancarMensaje({ tenantId, salaId, mensajeId, personaId, texto: 'hola' });
    await puerto.decidirPropuesta(propuestaId, { personaId, sentido: 'aprobada' });
    expect(arrancados).toEqual([
      { nombre: 'mensajeDeSala', id: `sala-mensaje-${mensajeId}`, cola: 'cola-de-la-sala' },
    ]);
    expect(senales).toEqual([{ id: `propuesta-${propuestaId}`, senal: 'decisionDePropuesta' }]);
  });
});
