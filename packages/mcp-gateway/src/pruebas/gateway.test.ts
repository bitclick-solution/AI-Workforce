/**
 * El gateway contra la base real y un servidor MCP real.
 *
 * No hay dobles de prueba en el camino que se está comprobando: PostgreSQL con sus
 * políticas de RLS, el libro de auditoría con su hash encadenado y un servidor MCP
 * que habla el protocolo. Lo único que no es de producción son los datos.
 */
import { conTenant, crearConexion, uuidV7 } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  sembrarFinanzas,
} from '@aiw/db/pruebas';
import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  NOMBRE_CONECTOR_DEMO,
  REFERENCIA_SECRETO_DEMO,
  VARIABLE_SECRETO_DEMO,
  montarDemoEnMemoria,
} from '@aiw/connector-demo';
import { leerCadena, verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCIONES,
  Gateway,
  HerramientaFallo,
  HerramientaNoAutorizada,
  MARCA_OCULTA,
  PasoNoPermitido,
  RegistroDeServidores,
  Secreto,
  conectarPorMcp,
  resolvedorDeEntorno,
  type ContextoDeLlamada,
} from '../index.js';

// El secreto de la prueba se genera en memoria y no sale de este proceso: el
// repositorio no contiene ninguno, ni siquiera de juguete.
const SECRETO = `demo-${uuidV7()}`;
const ENTORNO = { [VARIABLE_SECRETO_DEMO]: SECRETO };

const PRESUPUESTO = { limiteEuros: 2, gastadoEuros: 0 };

describe.skipIf(!HAY_BASE_DE_DATOS)('gateway MCP · contra la base y un servidor MCP', () => {
  let cliente: postgres.Sql;
  let cierre: () => Promise<void>;
  const gateways: Gateway[] = [];

  beforeAll(() => {
    const conexion = crearConexion({ url: URL_BASE_DE_DATOS ?? '' });
    cliente = conexion.cliente;
    cierre = conexion.cerrar;
  });

  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.cerrar()));
  });

  afterAll(async () => {
    await cierre();
  });

  /** Siembra Finanzas, crea la tarea y devuelve el gateway ya cableado. */
  async function montar(opciones: { fallosIniciales?: number; listaBlanca?: string[] } = {}) {
    const sembrado = await sembrarFinanzas(cliente, {
      nombre: `Prueba gateway ${uuidV7()}`,
      conector: NOMBRE_CONECTOR_DEMO,
      referenciaSecreto: REFERENCIA_SECRETO_DEMO,
      listaBlanca: opciones.listaBlanca ?? [HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA],
    });

    const montados: Awaited<ReturnType<typeof montarDemoEnMemoria>>[] = [];
    const registro = new RegistroDeServidores().registrar(
      NOMBRE_CONECTOR_DEMO,
      async (secreto) => {
        const montado = await montarDemoEnMemoria({
          credencial: secreto?.revelar() ?? '',
          credencialEsperada: SECRETO,
          ...(opciones.fallosIniciales === undefined
            ? {}
            : { fallosIniciales: opciones.fallosIniciales }),
        });
        montados.push(montado);
        return conectarPorMcp(montado.transporte, NOMBRE_CONECTOR_DEMO);
      },
    );

    const gateway = new Gateway({
      cliente,
      registro,
      secretos: resolvedorDeEntorno(ENTORNO),
    });
    gateways.push(gateway);

    async function crearTarea(puesto: { puestoId: string; versionPuestoId: string }) {
      const tareaId = await conTenant(cliente, sembrado.tenantId, async (tx) => {
        const [tarea] = await tx<{ id: string }[]>`
          insert into tarea (
            tenant_id, puesto_id, version_puesto_id, origen, estado, presupuesto_euros
          ) values (
            ${sembrado.tenantId}, ${puesto.puestoId}, ${puesto.versionPuestoId},
            'manual', 'en_curso', 2
          )
          returning id
        `;
        if (!tarea) throw new Error('No se creó la tarea de la prueba.');
        await tx`update tarea set tarea_raiz_id = ${tarea.id} where id = ${tarea.id}`;
        return tarea.id;
      });
      const contexto: ContextoDeLlamada = {
        tenantId: sembrado.tenantId,
        puestoId: puesto.puestoId,
        versionPuestoId: puesto.versionPuestoId,
        tareaId,
      };
      return contexto;
    }

    return { sembrado, gateway, crearTarea, montados };
  }

  it('el catálogo solo trae las herramientas de la lista blanca, ya clasificadas', async () => {
    const { gateway, crearTarea, sembrado } = await montar({
      listaBlanca: [HERRAMIENTA_LISTAR],
    });
    const contexto = await crearTarea(sembrado.cobros);

    const catalogo = await gateway.herramientasPara(contexto);

    expect(catalogo.herramientas.map((h) => h.nombre)).toEqual([HERRAMIENTA_LISTAR]);
    expect(catalogo.herramientas[0]?.tipo).toBe('lectura');
    expect(catalogo.nivelesPorClase).toEqual({ lectura: 'n3', escritura: 'n1' });
    expect(catalogo.estadoPuesto).toBe('activo');
  });

  it('una lectura N3 ejecuta y deja entrada de auditoría con la herramienta', async () => {
    const { gateway, crearTarea, sembrado } = await montar();
    const contexto = await crearTarea(sembrado.cobros);

    const llamada = await gateway.llamar(contexto, {
      herramienta: HERRAMIENTA_LISTAR,
      argumentos: {},
      presupuesto: PRESUPUESTO,
    });

    expect(llamada.nivelAplicado).toBe('n3');
    expect(llamada.texto).toContain('F-2026-0001');

    const cadena = await conTenant(cliente, sembrado.tenantId, (tx) =>
      leerCadena(tx, sembrado.tenantId),
    );
    const llamadas = cadena.filter((e) => e.accion === ACCIONES.llamada);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.herramienta).toBe(HERRAMIENTA_LISTAR);
    expect(llamadas[0]?.nivelAplicado).toBe('n3');
    expect(cadena.some((e) => e.accion === ACCIONES.descubiertas)).toBe(true);

    const verificacion = await conTenant(cliente, sembrado.tenantId, (tx) =>
      verificarCadenaEnBase(tx, sembrado.tenantId),
    );
    expect(verificacion.valida).toBe(true);
  });

  it('una herramienta fuera de la lista blanca se rechaza y se anota como rechazado', async () => {
    const { gateway, crearTarea, sembrado } = await montar({
      listaBlanca: [HERRAMIENTA_LISTAR],
    });
    const contexto = await crearTarea(sembrado.cobros);

    await expect(
      gateway.llamar(contexto, {
        herramienta: HERRAMIENTA_NOTA,
        argumentos: { factura: 'F-2026-0001', texto: 'Hola.' },
        presupuesto: PRESUPUESTO,
      }),
    ).rejects.toBeInstanceOf(HerramientaNoAutorizada);

    const cadena = await conTenant(cliente, sembrado.tenantId, (tx) =>
      leerCadena(tx, sembrado.tenantId),
    );
    const rechazos = cadena.filter((e) => e.accion === ACCIONES.rechazada);
    expect(rechazos).toHaveLength(1);
    expect(rechazos[0]?.resultado).toBe('rechazado');
    expect(rechazos[0]?.herramienta).toBe(HERRAMIENTA_NOTA);
  });

  it('una escritura N1 sin aprobación no pasa por el gateway', async () => {
    const { gateway, crearTarea, sembrado, montados } = await montar();
    const contexto = await crearTarea(sembrado.cobros);

    await expect(
      gateway.llamar(contexto, {
        herramienta: HERRAMIENTA_NOTA,
        argumentos: { factura: 'F-2026-0001', texto: 'Sin permiso.' },
        presupuesto: PRESUPUESTO,
      }),
    ).rejects.toBeInstanceOf(PasoNoPermitido);

    expect(montados[0]?.demo.notas).toHaveLength(0);
  });

  it('la misma escritura con una aprobación decidida sí ejecuta y la anota', async () => {
    const { gateway, crearTarea, sembrado, montados } = await montar();
    const contexto = await crearTarea(sembrado.cobros);
    const aprobacionId = uuidV7();

    const llamada = await gateway.llamar(contexto, {
      herramienta: HERRAMIENTA_NOTA,
      argumentos: { factura: 'F-2026-0001', texto: 'Te recordamos el pago pendiente.' },
      presupuesto: PRESUPUESTO,
      aprobacionId,
    });

    expect(llamada.nivelAplicado).toBe('n1');
    expect(montados[0]?.demo.notas).toHaveLength(1);

    const cadena = await conTenant(cliente, sembrado.tenantId, (tx) =>
      leerCadena(tx, sembrado.tenantId),
    );
    const anotada = cadena.find((e) => e.accion === ACCIONES.llamada);
    expect(anotada?.datosReferenciados).toEqual(
      expect.arrayContaining([{ tipo: 'aprobacion', id: aprobacionId }]),
    );
  });

  it('un puesto en prueba no ejecuta la escritura ni con aprobación', async () => {
    const { gateway, crearTarea, sembrado, montados } = await montar();
    const contexto = await crearTarea(sembrado.conciliacion);

    const fallo = await gateway
      .llamar(contexto, {
        herramienta: HERRAMIENTA_NOTA,
        argumentos: { factura: 'F-2026-0001', texto: 'En prueba.' },
        presupuesto: PRESUPUESTO,
        aprobacionId: uuidV7(),
      })
      .catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(PasoNoPermitido);
    expect((fallo as PasoNoPermitido).veredicto.decision).toBe('simular');
    expect(montados[0]?.demo.notas).toHaveLength(0);
  });

  it('un puesto en prueba sí lee', async () => {
    const { gateway, crearTarea, sembrado } = await montar();
    const contexto = await crearTarea(sembrado.conciliacion);

    const llamada = await gateway.llamar(contexto, {
      herramienta: HERRAMIENTA_LISTAR,
      argumentos: {},
      presupuesto: PRESUPUESTO,
    });

    expect(llamada.texto).toContain('F-2026-0003');
  });

  it('el presupuesto agotado cierra la puerta antes de llamar a nadie', async () => {
    const { gateway, crearTarea, sembrado, montados } = await montar();
    const contexto = await crearTarea(sembrado.cobros);

    const fallo = await gateway
      .llamar(contexto, {
        herramienta: HERRAMIENTA_LISTAR,
        argumentos: {},
        presupuesto: { limiteEuros: 1, gastadoEuros: 1 },
      })
      .catch((error: unknown) => error);

    expect((fallo as PasoNoPermitido).veredicto.decision).toBe('detener');
    expect(montados[0]?.demo.llamadas.get(HERRAMIENTA_LISTAR)).toBeUndefined();
  });

  it('el fallo del conector llega como excepción para que la actividad reintente', async () => {
    const { gateway, crearTarea, sembrado } = await montar({ fallosIniciales: 1 });
    const contexto = await crearTarea(sembrado.cobros);

    await expect(
      gateway.llamar(contexto, {
        herramienta: HERRAMIENTA_LISTAR,
        argumentos: {},
        presupuesto: PRESUPUESTO,
      }),
    ).rejects.toBeInstanceOf(HerramientaFallo);

    // El fallo queda en el libro: un reintento que no deja rastro no se puede contar.
    const cadena = await conTenant(cliente, sembrado.tenantId, (tx) =>
      leerCadena(tx, sembrado.tenantId),
    );
    expect(cadena.some((e) => e.accion === ACCIONES.llamada && e.resultado === 'error')).toBe(true);

    // Y la siguiente llamada ya funciona: el conector solo fallaba la primera.
    const segunda = await gateway.llamar(contexto, {
      herramienta: HERRAMIENTA_LISTAR,
      argumentos: {},
      presupuesto: PRESUPUESTO,
    });
    expect(segunda.texto).toContain('F-2026-0002');
  });

  it('revocar la autorización cierra la herramienta sin borrar la fila', async () => {
    const { gateway, crearTarea, sembrado } = await montar();
    const contexto = await crearTarea(sembrado.cobros);

    await conTenant(cliente, sembrado.tenantId, (tx) => tx`
      update autorizacion_herramientas set revocada_en = now()
      where tenant_id = ${sembrado.tenantId} and id = ${sembrado.cobros.autorizacionId}
    `);

    const catalogo = await gateway.herramientasPara(contexto);
    expect(catalogo.herramientas).toHaveLength(0);
    await expect(
      gateway.llamar(contexto, {
        herramienta: HERRAMIENTA_LISTAR,
        argumentos: {},
        presupuesto: PRESUPUESTO,
      }),
    ).rejects.toBeInstanceOf(HerramientaNoAutorizada);
  });

  it('el valor del secreto no aparece en el catálogo, ni en el resultado, ni en el libro', async () => {
    const { gateway, crearTarea, sembrado } = await montar();
    const contexto = await crearTarea(sembrado.cobros);

    const catalogo = await gateway.herramientasPara(contexto);
    const llamada = await gateway.llamar(contexto, {
      herramienta: HERRAMIENTA_LISTAR,
      argumentos: {},
      presupuesto: PRESUPUESTO,
    });
    const cadena = await conTenant(cliente, sembrado.tenantId, (tx) =>
      leerCadena(tx, sembrado.tenantId),
    );

    // Todo lo que sale del gateway, en una sola cadena, y el secreto no está.
    const todo = JSON.stringify({ catalogo, llamada, cadena });
    expect(todo).not.toContain(SECRETO);
    // Lo que sí está es la referencia, que es lo que se audita.
    const conector = await conTenant(cliente, sembrado.tenantId, (tx) => tx<
      { referencia_secreto: string }[]
    >`select referencia_secreto from conector where tenant_id = ${sembrado.tenantId}`);
    expect(conector[0]?.referencia_secreto).toBe(REFERENCIA_SECRETO_DEMO);
  });
});

describe('secreto · no se imprime por ninguna de sus puertas', () => {
  it('se oculta en texto, en JSON y en la inspección de Node', () => {
    const secreto = new Secreto('env:PRUEBA', 'valor-que-no-debe-salir');

    expect(String(secreto)).toBe(MARCA_OCULTA);
    expect(`${secreto}`).toBe(MARCA_OCULTA);
    expect(JSON.stringify({ secreto })).not.toContain('valor-que-no-debe-salir');
    expect(JSON.stringify({ anidado: { secreto } })).toContain(MARCA_OCULTA);
    expect(secreto.revelar()).toBe('valor-que-no-debe-salir');
    expect(secreto.referencia).toBe('env:PRUEBA');
  });

  it('el resolvedor de entorno explica qué falta en vez de devolver vacío', () => {
    const resolvedor = resolvedorDeEntorno({});
    expect(() => resolvedor.resolver('env:NO_EXISTE')).toThrow(/NO_EXISTE/);
    expect(() => resolvedor.resolver('vault:algo')).toThrow(/env:/);
  });
});

if (!HAY_BASE_DE_DATOS) {
  // eslint-disable-next-line no-console
  console.warn(`[gateway] ${MOTIVO_SALTO}`);
}
