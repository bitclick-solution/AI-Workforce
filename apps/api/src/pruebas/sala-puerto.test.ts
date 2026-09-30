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

import type { BuscadorCentrifugo } from '@aiw/rooms/centrifugo';
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

  describe('sala v1: salas por equipo y presencia en vivo', () => {
    const centrifugo = {
      urlApi: 'http://centrifugo.local:8000',
      claveApi: 'clave-de-prueba',
      secretoHmac: uuidV7(),
    };
    const configuracionV1 = {
      ...configuracion,
      v1: { centrifugo },
    } satisfies ConfiguracionSala;
    let puestoCobrosId = '';
    let salaEquipoId = '';

    beforeAll(async () => {
      const sembrado = await sembrarFinanzas(cliente, {
        nombre: `Sala puerto v1 ${uuidV7()}`,
        conector: 'demo-cobros',
        referenciaSecreto: 'env:DEMO_CONECTOR_SECRETO',
        listaBlanca: ['listar_facturas_vencidas'],
        soloCobros: true,
      });
      puestoCobrosId = sembrado.cobros.puestoId;
      // Reutiliza el tenant y la sala general de fuera: es más sencillo probar los
      // participantes sobre datos ya sembrados que montar otra organización entera.
      // Los mensajes de sinLeer/menciones van en una sala propia, no en la general:
      // la general de fuera los lleva con `creado_en` adelantado a propósito (para
      // que el orden entre mensajes de la misma transacción no dependa del reloj), y
      // esa fecha futura seguiría por delante de `marcarLeido` mucho después de que
      // esta prueba termine.
      await conTenant(cliente, tenantId, async (tx) => {
        await tx`
          insert into sala_participante (tenant_id, sala_id, persona_id, rol)
          values (${tenantId}, ${salaId}, ${personaId}, 'humano')
        `;
        await tx`
          insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
          values (${tenantId}, ${salaId}, ${sembrado.cobros.puestoId}, 'agente')
        `;
        await tx`
          insert into tarea (tenant_id, puesto_id, version_puesto_id, origen, estado)
          values (${tenantId}, ${sembrado.cobros.puestoId}, ${sembrado.cobros.versionPuestoId}, 'sala', 'en_curso')
        `;
        const [equipo] = await tx<{ id: string }[]>`
          insert into sala (tenant_id, departamento_id, ambito, nombre)
          values (${tenantId}, ${sembrado.departamentoId}, 'departamento', 'Sala de Finanzas')
          returning id
        `;
        salaEquipoId = equipo?.id ?? '';
        await tx`
          insert into sala_participante (tenant_id, sala_id, persona_id, rol)
          values (${tenantId}, ${salaEquipoId}, ${personaId}, 'humano')
        `;
        await tx`
          insert into mensaje (tenant_id, sala_id, autor_puesto_id, cuerpo)
          values (${tenantId}, ${salaEquipoId}, ${sembrado.cobros.puestoId}, 'Hola @Jesús, ¿cómo va la conciliación?')
        `;
      });
    });

    it('esMiembro distingue a un participante de quien no lo es', async () => {
      const puerto = puertoSala(conexion.cliente, flujos, configuracion);
      expect(await puerto.esMiembro(tenantId, salaId, personaId)).toBe(true);
      expect(await puerto.esMiembro(tenantId, salaId, uuidV7())).toBe(false);
    });

    it('da la sala de equipo con sus mensajes sin leer y menciones, y ninguno tras marcarla leída', async () => {
      const puerto = puertoSala(conexion.cliente, flujos, configuracion);
      const salas = await puerto.salasDeLaPersona(tenantId, personaId);
      const equipo = salas.find((s) => s.id === salaEquipoId);
      expect(equipo?.ambito).toBe('equipo');
      expect(equipo?.sinLeer).toBe(1);
      expect(equipo?.menciones).toBe(1);

      await puerto.marcarLeido(tenantId, salaEquipoId, personaId);
      const trasLeer = (await puerto.salasDeLaPersona(tenantId, personaId)).find(
        (s) => s.id === salaEquipoId,
      );
      expect(trasLeer?.sinLeer).toBe(0);
      expect(trasLeer?.menciones).toBe(0);
    });

    it('sin Centrifugo, un agente con tarea en curso está trabajando y la persona sale añadida', async () => {
      const puerto = puertoSala(conexion.cliente, flujos, configuracion);
      const miembros = await puerto.miembrosDeSala(tenantId, salaId);
      const cobros = miembros.find((m) => m.id === puestoCobrosId);
      expect(cobros?.estado).toBe('trabajando');
      const humana = miembros.find((m) => m.id === personaId);
      // Sin `v1` no hay presencia de Centrifugo que consultar: nadie se ve conectado.
      expect(humana?.estado).toBe('anadido');
    });

    it('con Centrifugo, la persona conectada se ve en la sala', async () => {
      const buscar: BuscadorCentrifugo = async () =>
        new Response(JSON.stringify({ result: { presence: { c1: { user: personaId } } } }), {
          status: 200,
        });
      const puerto = puertoSala(conexion.cliente, flujos, configuracionV1, buscar);
      const miembros = await puerto.miembrosDeSala(tenantId, salaId);
      expect(miembros.find((m) => m.id === personaId)?.estado).toBe('en-la-sala');
    });

    it('si Centrifugo cae, la sala sigue funcionando sin presencia en vivo', async () => {
      const buscar: BuscadorCentrifugo = async () => {
        throw new Error('Centrifugo no responde');
      };
      const puerto = puertoSala(conexion.cliente, flujos, configuracionV1, buscar);
      const miembros = await puerto.miembrosDeSala(tenantId, salaId);
      expect(miembros.find((m) => m.id === personaId)?.estado).toBe('anadido');
    });

    it('emite el token de conexión y de canal solo a un miembro de la sala', async () => {
      const buscar: BuscadorCentrifugo = async () => new Response('{}', { status: 200 });
      const puerto = puertoSala(conexion.cliente, flujos, configuracionV1, buscar);
      const emitido = await puerto.tokenDeSala(tenantId, salaId, personaId);
      expect(emitido?.canal).toBe(`sala:${tenantId}:${salaId}`);
      expect(await puerto.tokenDeSala(tenantId, salaId, uuidV7())).toBeNull();
    });

    it('avisa de que se escribe con una llamada al API de Centrifugo, sin guardar nada', async () => {
      const llamadas: unknown[] = [];
      const buscar: BuscadorCentrifugo = async (url, opciones) => {
        llamadas.push({ url, cuerpo: JSON.parse(opciones.body) });
        return new Response('{}', { status: 200 });
      };
      const puerto = puertoSala(conexion.cliente, flujos, configuracionV1, buscar);
      await puerto.avisarEscribiendo(tenantId, salaId, personaId);
      expect(llamadas).toHaveLength(1);
      expect((llamadas[0] as { cuerpo: { method: string } }).cuerpo.method).toBe('publish');
    });

    // Presencia configurable desde el perfil (ADR-026): con el ajuste desactivado,
    // ni la lista de miembros ni el token de canal ni «escribiendo» revelan que la
    // persona está conectada, aunque Centrifugo la vea.
    it('con la presencia oculta, sale añadida, el token de canal lleva el override y no se avisa de que escribe', async () => {
      await conTenant(
        cliente,
        tenantId,
        (tx) => tx`
          update persona set mostrar_presencia = false
          where tenant_id = ${tenantId} and id = ${personaId}
        `,
      );
      try {
        const conectada: BuscadorCentrifugo = async () =>
          new Response(JSON.stringify({ result: { presence: { c1: { user: personaId } } } }), {
            status: 200,
          });
        const puerto = puertoSala(conexion.cliente, flujos, configuracionV1, conectada);

        const miembros = await puerto.miembrosDeSala(tenantId, salaId);
        expect(miembros.find((m) => m.id === personaId)?.estado).toBe('anadido');

        const emitido = await puerto.tokenDeSala(tenantId, salaId, personaId);
        const [, cargaB64] = emitido?.canalToken.split('.') ?? [];
        const carga = JSON.parse(
          Buffer.from(
            (cargaB64 ?? '').replace(/-/g, '+').replace(/_/g, '/'),
            'base64',
          ).toString('utf8'),
        ) as { override?: unknown };
        expect(carga.override).toEqual({
          presence: { value: false },
          join_leave: { value: false },
        });

        const llamadas: unknown[] = [];
        const registraLlamadas: BuscadorCentrifugo = async (url, opciones) => {
          llamadas.push({ url, opciones });
          return new Response('{}', { status: 200 });
        };
        const puertoQueRegistra = puertoSala(
          conexion.cliente,
          flujos,
          configuracionV1,
          registraLlamadas,
        );
        await puertoQueRegistra.avisarEscribiendo(tenantId, salaId, personaId);
        expect(llamadas).toHaveLength(0);
      } finally {
        await conTenant(
          cliente,
          tenantId,
          (tx) => tx`
            update persona set mostrar_presencia = true
            where tenant_id = ${tenantId} and id = ${personaId}
          `,
        );
      }
    });
  });
});
