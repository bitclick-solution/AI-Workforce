/**
 * El contador de tareas v0 contra PostgreSQL: una unidad por tarea raíz, coste de
 * modelos desde los usos reales y nada que se cobre dos veces.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` estas pruebas se saltan con un mensaje.
 */
import {
  ROL_APLICACION,
  ROL_MIGRADOR,
  aplicarMigraciones,
  conTenant,
  conTenantYRol,
  crearConexion,
  purgarOrganizacion,
  uuidV7,
} from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  URL_BASE_DE_DATOS,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCION_TAREA_CONTADA,
  ACCION_USO_MODELO,
  TIPO_EVENTO_CONTADOR,
  calcularCosteEuros,
  registrarTarifa,
  registrarTareaRaiz,
  registrarUsoDeModelo,
  tarifaVigente,
} from '../contador.js';
import {
  consumoDelPeriodo,
  costeDeTareaRaiz,
  costePorPuesto,
  panelDelContador,
  tareasDelPeriodo,
} from '../contador-consultas.js';
import { verificarCadenaEnBase } from '../libro.js';

const PROVEEDOR = 'proveedor-de-prueba';
const MODELO = 'modelo-de-prueba';

const TITULO = HAY_BASE_DE_DATOS
  ? 'contador de tareas v0'
  : `contador de tareas v0 — SALTADO. ${MOTIVO_SALTO}`;

interface Contador {
  tareas: number;
  pasos: number;
  acciones: number;
  costeEuros: number;
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let vecina: OrganizacionSembrada;
  let tarifaId: string;

  async function contador(tenantId: string): Promise<Contador> {
    const [fila] = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ tareas: string; pasos: string; acciones: string; coste_euros: string }[]>`
        select tareas, pasos, acciones, coste_euros
        from contador_consumo
        where tenant_id = ${tenantId} and periodo = date_trunc('month', now())::date
      `,
    );
    return {
      tareas: Number(fila?.tareas ?? 0),
      pasos: Number(fila?.pasos ?? 0),
      acciones: Number(fila?.acciones ?? 0),
      costeEuros: Number(fila?.coste_euros ?? 0),
    };
  }

  async function cuantasEntradas(tenantId: string, accion: string): Promise<number> {
    const [fila] = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from entrada_auditoria
        where tenant_id = ${tenantId} and accion = ${accion}
      `,
    );
    return Number(fila?.total ?? 0);
  }

  async function cuantosEventos(tenantId: string): Promise<number> {
    const [fila] = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from evento_salida
        where tenant_id = ${tenantId} and tipo = ${TIPO_EVENTO_CONTADOR}
      `,
    );
    return Number(fila?.total ?? 0);
  }

  /** Abre una tarea raíz nueva en la organización sembrada. */
  async function nuevaTareaRaiz(): Promise<string> {
    const id = uuidV7();
    await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx`
      insert into tarea (id, tenant_id, tarea_raiz_id, puesto_id, version_puesto_id, origen, estado)
      values (
        ${id}, ${org.tenantId}, ${id}, ${org.puestoId}, ${org.versionPuestoId},
        'programacion', 'pendiente'
      )
    `,
    );
    return id;
  }

  beforeAll(async () => {
    cliente = conectar(10);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'contador');
    vecina = await sembrarOrganizacion(cliente, 'contador-vecina');

    const registrada = await conTenant(cliente, org.tenantId, (tx) =>
      registrarTarifa(tx, org.tenantId, {
        proveedor: PROVEEDOR,
        modelo: MODELO,
        eurosPorMillonEntrada: 3,
        eurosPorMillonSalida: 15,
        eurosPorMillonEntradaCache: 0.3,
        vigenteDesde: new Date('2026-01-01T00:00:00.000Z'),
        fuente: 'prueba',
      }),
    );
    tarifaId = registrada.id;
  });

  afterAll(async () => {
    if (org) await purgarOrganizacion(cliente, org.tenantId);
    if (vecina) await purgarOrganizacion(cliente, vecina.tenantId);
    // El libro no se borra fila a fila ni en las pruebas: el disparador lo impide.
    await cliente?.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  describe('alta de tarifas', () => {
    it('la tarifa queda registrada, anotada en el libro y con su evento', async () => {
      const tarifa = await conTenant(cliente, org.tenantId, (tx) =>
        tarifaVigente(tx, org.tenantId, PROVEEDOR, MODELO, new Date()),
      );
      expect(tarifa?.id).toBe(tarifaId);
      expect(tarifa?.eurosPorMillonSalida).toBe(15);
      expect(await cuantasEntradas(org.tenantId, 'tarifa.registrada')).toBe(1);
      expect(await cuantosEventos(org.tenantId)).toBeGreaterThan(0);
    });

    it('sin tarifa anterior al uso, no hay tarifa vigente', async () => {
      const tarifa = await conTenant(cliente, org.tenantId, (tx) =>
        tarifaVigente(tx, org.tenantId, PROVEEDOR, MODELO, new Date('2025-01-01T00:00:00.000Z')),
      );
      expect(tarifa).toBeUndefined();
    });
  });

  describe('una tarea raíz suma una unidad y solo una', () => {
    it('la primera vez cuenta', async () => {
      const antes = await contador(org.tenantId);
      const resultado = await conTenant(cliente, org.tenantId, (tx) =>
        registrarTareaRaiz(tx, org.tenantId, {
          tareaId: org.tareaId,
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
        }),
      );
      const despues = await contador(org.tenantId);
      expect(resultado.conto).toBe(true);
      expect(despues.tareas).toBe(antes.tareas + 1);
      expect(despues.acciones).toBe(antes.acciones + 1);
    });

    it('el reintento no vuelve a sumar', async () => {
      const antes = await contador(org.tenantId);
      const resultado = await conTenant(cliente, org.tenantId, (tx) =>
        registrarTareaRaiz(tx, org.tenantId, {
          tareaId: org.tareaId,
          puestoId: org.puestoId,
        }),
      );
      const despues = await contador(org.tenantId);
      expect(resultado.conto).toBe(false);
      expect(despues).toEqual(antes);
      expect(await cuantasEntradas(org.tenantId, ACCION_TAREA_CONTADA)).toBe(1);
    });

    it('una delegación no es una unidad: cuenta dentro de su raíz (ADR-003)', async () => {
      const antes = await contador(org.tenantId);
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          registrarTareaRaiz(tx, org.tenantId, {
            tareaId: org.tareaHijaId,
            puestoId: org.puestoId,
          }),
        ),
      ).rejects.toThrow(/no es raíz/);
      expect(await contador(org.tenantId)).toEqual(antes);
    });

    it('una tarea de otro tenant no se cuenta desde aquí', async () => {
      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          registrarTareaRaiz(tx, org.tenantId, {
            tareaId: vecina.tareaId,
            puestoId: org.puestoId,
          }),
        ),
      ).rejects.toThrow(/no existe en este tenant/);
    });

    it('ocho reintentos a la vez dejan una sola unidad', async () => {
      const tareaId = await nuevaTareaRaiz();
      const antes = await contador(org.tenantId);
      const resultados = await Promise.all(
        Array.from({ length: 8 }, () =>
          conTenant(cliente, org.tenantId, (tx) =>
            registrarTareaRaiz(tx, org.tenantId, { tareaId, puestoId: org.puestoId }),
          ),
        ),
      );
      const despues = await contador(org.tenantId);
      expect(resultados.filter((r) => r.conto).length).toBe(1);
      expect(despues.tareas).toBe(antes.tareas + 1);

      const [fila] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ total: string }[]>`
          select count(*) as total from entrada_auditoria
          where tenant_id = ${org.tenantId} and tarea_id = ${tareaId}
            and accion = ${ACCION_TAREA_CONTADA}
        `,
      );
      expect(fila?.total).toBe('1');
    });
  });

  describe('coste de modelos desde los usos reales', () => {
    it('el uso se registra con el coste de la tarifa vigente y suma al contador', async () => {
      const antes = await contador(org.tenantId);
      const esperado = calcularCosteEuros(
        {
          id: tarifaId,
          proveedor: PROVEEDOR,
          modelo: MODELO,
          eurosPorMillonEntrada: 3,
          eurosPorMillonSalida: 15,
          eurosPorMillonEntradaCache: 0.3,
          vigenteDesde: new Date('2026-01-01T00:00:00.000Z'),
        },
        { entrada: 120_000, salida: 8_000, entradaCache: 40_000 },
      );

      const registrado = await conTenant(cliente, org.tenantId, (tx) =>
        registrarUsoDeModelo(tx, org.tenantId, {
          tareaId: org.tareaId,
          pasoId: org.pasoId,
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
          proveedor: PROVEEDOR,
          modelo: MODELO,
          tokens: { entrada: 120_000, salida: 8_000, entradaCache: 40_000 },
          claveIdempotencia: 'peticion-1',
        }),
      );
      const despues = await contador(org.tenantId);

      expect(registrado.yaEstaba).toBe(false);
      expect(registrado.tarifaId).toBe(tarifaId);
      expect(registrado.costeEuros).toBeCloseTo(esperado, 4);
      expect(registrado.tareaRaizId).toBe(org.tareaId);
      expect(despues.costeEuros).toBeCloseTo(antes.costeEuros + esperado, 4);
      expect(despues.acciones).toBe(antes.acciones + 1);
      expect(despues.tareas).toBe(antes.tareas);
      expect(await cuantasEntradas(org.tenantId, ACCION_USO_MODELO)).toBe(1);
    });

    it('la misma clave de idempotencia no vuelve a cobrar', async () => {
      const antes = await contador(org.tenantId);
      const repetido = await conTenant(cliente, org.tenantId, (tx) =>
        registrarUsoDeModelo(tx, org.tenantId, {
          tareaId: org.tareaId,
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
          proveedor: PROVEEDOR,
          modelo: MODELO,
          tokens: { entrada: 120_000, salida: 8_000, entradaCache: 40_000 },
          claveIdempotencia: 'peticion-1',
        }),
      );
      const despues = await contador(org.tenantId);
      expect(repetido.yaEstaba).toBe(true);
      expect(despues).toEqual(antes);
      expect(await cuantasEntradas(org.tenantId, ACCION_USO_MODELO)).toBe(1);
    });

    it('el uso de una delegación suma al coste de su tarea raíz', async () => {
      const registrado = await conTenant(cliente, org.tenantId, (tx) =>
        registrarUsoDeModelo(tx, org.tenantId, {
          tareaId: org.tareaHijaId,
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
          proveedor: PROVEEDOR,
          modelo: MODELO,
          tokens: { entrada: 50_000, salida: 2_000 },
          claveIdempotencia: 'peticion-delegada',
        }),
      );
      expect(registrado.tareaRaizId).toBe(org.tareaId);

      const coste = await conTenant(cliente, org.tenantId, (tx) =>
        costeDeTareaRaiz(tx, org.tenantId, org.tareaId),
      );
      expect(coste.usos).toBe(2);
      expect(coste.costeModelosEuros).toBeGreaterThan(registrado.costeEuros);
    });

    it('sin tarifa vigente falla y no deja rastro', async () => {
      const antes = await contador(org.tenantId);
      const entradasAntes = await cuantasEntradas(org.tenantId, ACCION_USO_MODELO);

      await expect(
        conTenant(cliente, org.tenantId, (tx) =>
          registrarUsoDeModelo(tx, org.tenantId, {
            tareaId: org.tareaId,
            puestoId: org.puestoId,
            versionPuestoId: org.versionPuestoId,
            proveedor: PROVEEDOR,
            modelo: 'modelo-sin-tarifa',
            tokens: { entrada: 10_000, salida: 1_000 },
            claveIdempotencia: 'peticion-sin-tarifa',
          }),
        ),
      ).rejects.toThrow(/Sin tarifa vigente/);

      expect(await contador(org.tenantId)).toEqual(antes);
      expect(await cuantasEntradas(org.tenantId, ACCION_USO_MODELO)).toBe(entradasAntes);
      const [fila] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ total: string }[]>`
          select count(*) as total from uso_modelo
          where tenant_id = ${org.tenantId} and clave_idempotencia = 'peticion-sin-tarifa'
        `,
      );
      expect(fila?.total).toBe('0');
    });

    it('subir la tarifa no reescribe lo que ya costó', async () => {
      const [antes] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ coste_euros: string; tarifa_modelo_id: string }[]>`
          select coste_euros, tarifa_modelo_id from uso_modelo
          where tenant_id = ${org.tenantId} and clave_idempotencia = 'peticion-1'
        `,
      );

      const nueva = await conTenant(cliente, org.tenantId, (tx) =>
        registrarTarifa(tx, org.tenantId, {
          proveedor: PROVEEDOR,
          modelo: MODELO,
          eurosPorMillonEntrada: 30,
          eurosPorMillonSalida: 150,
          vigenteDesde: new Date(),
          fuente: 'prueba: subida de precio',
        }),
      );

      const [despues] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ coste_euros: string; tarifa_modelo_id: string }[]>`
          select coste_euros, tarifa_modelo_id from uso_modelo
          where tenant_id = ${org.tenantId} and clave_idempotencia = 'peticion-1'
        `,
      );
      expect(despues?.coste_euros).toBe(antes?.coste_euros);
      expect(despues?.tarifa_modelo_id).toBe(antes?.tarifa_modelo_id);

      // Y el uso siguiente sí paga el precio nuevo.
      const caro = await conTenant(cliente, org.tenantId, (tx) =>
        registrarUsoDeModelo(tx, org.tenantId, {
          tareaId: org.tareaId,
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
          proveedor: PROVEEDOR,
          modelo: MODELO,
          tokens: { entrada: 120_000, salida: 8_000 },
          claveIdempotencia: 'peticion-con-tarifa-nueva',
        }),
      );
      expect(caro.tarifaId).toBe(nueva.id);
      expect(caro.costeEuros).toBeGreaterThan(Number(antes?.coste_euros ?? 0));
    });
  });

  describe('lo que lee el panel cuadra con lo que se escribió', () => {
    it('el consumo del periodo cuadra con los usos y con el libro', async () => {
      const consumo = await conTenant(cliente, org.tenantId, (tx) =>
        consumoDelPeriodo(tx, org.tenantId),
      );
      const [suma] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ usos: string; coste: string }[]>`
          select count(*) as usos, coalesce(sum(coste_euros), 0) as coste
          from uso_modelo where tenant_id = ${org.tenantId}
        `,
      );
      expect(consumo.costeModelosEuros).toBeCloseTo(Number(suma?.coste ?? 0), 4);
      // Todo el coste del contador viene de los usos: nada más cobra en esta rebanada.
      expect(consumo.costeEuros).toBeCloseTo(consumo.costeModelosEuros, 4);
      expect(consumo.ultimaAnotacion).toBeGreaterThan(0);
      expect(consumo.periodo).toMatch(/^\d{4}-\d{2}-01$/);
      expect(Number.isNaN(Date.parse(consumo.momento))).toBe(false);
    });

    it('las tareas del periodo traen su coste, su estado y sus delegaciones', async () => {
      const resultado = await conTenant(cliente, org.tenantId, (tx) =>
        tareasDelPeriodo(tx, org.tenantId, 50),
      );
      const raiz = resultado.tareas.find((t) => t.tareaId === org.tareaId);
      expect(raiz).toBeDefined();
      expect(raiz?.delegaciones).toBe(1);
      expect(raiz?.usos).toBeGreaterThan(1);
      expect(raiz?.costeModelosEuros).toBeGreaterThan(0);
      expect(raiz?.puesto).toBe('Contable');
      // La delegación no aparece como raíz: cuenta dentro de la suya.
      expect(resultado.tareas.some((t) => t.tareaId === org.tareaHijaId)).toBe(false);
      expect(resultado.total).toBe(resultado.tareas.length);
      expect(Object.values(resultado.porEstado).reduce((a, b) => a + b, 0)).toBe(resultado.total);
    });

    it('el coste por puesto suma lo mismo que los usos', async () => {
      const porPuesto = await conTenant(cliente, org.tenantId, (tx) =>
        costePorPuesto(tx, org.tenantId),
      );
      const [suma] = await conTenant(
        cliente,
        org.tenantId,
        (tx) => tx<{ coste: string }[]>`
          select coalesce(sum(coste_euros), 0) as coste from uso_modelo
          where tenant_id = ${org.tenantId}
        `,
      );
      const total = porPuesto.reduce((acc, fila) => acc + fila.costeModelosEuros, 0);
      expect(total).toBeCloseTo(Number(suma?.coste ?? 0), 4);
      expect(porPuesto[0]?.tokensEntrada).toBeGreaterThan(0);
      expect(porPuesto[0]?.tokensSalida).toBeGreaterThan(0);
    });

    it('el panel se lee de una vez y con el tenant fijado', async () => {
      const panel = await conTenant(cliente, org.tenantId, (tx) =>
        panelDelContador(tx, org.tenantId, 5),
      );
      expect(panel.consumo.tareas).toBeGreaterThan(0);
      expect(panel.tareas.tareas.length).toBeGreaterThan(0);
      expect(panel.porPuesto.length).toBeGreaterThan(0);
    });

    it('el vecino ve ceros y ninguna fila ajena', async () => {
      const consumo = await conTenantYRol(cliente, vecina.tenantId, ROL_APLICACION, (tx) =>
        consumoDelPeriodo(tx, vecina.tenantId),
      );
      expect(consumo.costeModelosEuros).toBe(0);

      const filas = await conTenantYRol(
        cliente,
        vecina.tenantId,
        ROL_APLICACION,
        (tx) => tx`select id from uso_modelo`,
      );
      expect(filas.length).toBe(0);
    });

    it('la cadena del libro sigue verificando después de todo', async () => {
      const resultado = await verificarCadenaEnBase(cliente, org.tenantId);
      expect(resultado.valida).toBe(true);
      expect(resultado.entradas).toBeGreaterThan(4);
    });
  });

  describe('las dos tablas nuevas están aisladas y son inmutables', () => {
    it('el rol de aplicación no puede escribir con el tenant de otro', async () => {
      await expect(
        conTenantYRol(
          cliente,
          vecina.tenantId,
          ROL_APLICACION,
          (tx) => tx`
            insert into uso_modelo (
              tenant_id, tarea_id, tarea_raiz_id, puesto_id, version_puesto_id,
              proveedor, modelo, tarifa_modelo_id, clave_idempotencia
            ) values (
              ${org.tenantId}, ${org.tareaId}, ${org.tareaId}, ${org.puestoId},
              ${org.versionPuestoId}, ${PROVEEDOR}, ${MODELO}, ${tarifaId}, 'colada'
            )
          `,
        ),
      ).rejects.toThrow(/row-level security|violates row-level/i);
    });

    it('el rol de aplicación no puede actualizarlas ni borrarlas', async () => {
      for (const tabla of ['uso_modelo', 'tarifa_modelo']) {
        await expect(
          conTenantYRol(cliente, org.tenantId, ROL_APLICACION, (tx) =>
            tx.unsafe(`update ${tabla} set creado_en = creado_en where tenant_id = $1`, [
              org.tenantId,
            ]),
          ),
          `${tabla} deja al rol de aplicación actualizar`,
        ).rejects.toThrow(/permission denied|permiso denegado/i);

        await expect(
          conTenantYRol(cliente, org.tenantId, ROL_APLICACION, (tx) =>
            tx.unsafe(`delete from ${tabla} where tenant_id = $1`, [org.tenantId]),
          ),
          `${tabla} deja al rol de aplicación borrar`,
        ).rejects.toThrow(/permission denied|permiso denegado/i);
      }
    });

    it('ni el dueño del esquema las actualiza: el disparador lo impide', async () => {
      for (const tabla of ['uso_modelo', 'tarifa_modelo']) {
        await expect(
          conTenantYRol(cliente, org.tenantId, ROL_MIGRADOR, (tx) =>
            tx.unsafe(`update ${tabla} set creado_en = creado_en where tenant_id = $1`, [
              org.tenantId,
            ]),
          ),
          `${tabla} deja al dueño del esquema actualizar`,
        ).rejects.toThrow(/es inmutable/);
      }
    });

    it('se escribe igual con el cliente de la aplicación, que no serializa fechas', async () => {
      // Regresión: `crearConexion` monta Drizzle sobre el cliente de `postgres`, y
      // Drizzle sustituye los serializadores de los tipos de fecha por uno
      // transparente. Pasar un `Date` como parámetro reventaba con
      // ERR_INVALID_ARG_TYPE solo por este camino —el de la aplicación—, mientras
      // el resto de estas pruebas, con el cliente crudo, pasaban.
      const aplicacion = crearConexion({
        url: URL_BASE_DE_DATOS ?? '',
        rolAplicacion: ROL_APLICACION,
      });
      try {
        const resultado = await conTenant(aplicacion.cliente, org.tenantId, async (tx) => {
          await registrarTarifa(tx, org.tenantId, {
            proveedor: PROVEEDOR,
            modelo: 'modelo-por-el-cliente-de-la-aplicacion',
            eurosPorMillonEntrada: 1,
            eurosPorMillonSalida: 5,
            vigenteDesde: new Date('2026-02-01T00:00:00.000Z'),
            fuente: 'prueba con el cliente de la aplicación',
          });
          return registrarUsoDeModelo(tx, org.tenantId, {
            tareaId: org.tareaId,
            puestoId: org.puestoId,
            versionPuestoId: org.versionPuestoId,
            proveedor: PROVEEDOR,
            modelo: 'modelo-por-el-cliente-de-la-aplicacion',
            tokens: { entrada: 100_000, salida: 10_000 },
            claveIdempotencia: 'peticion-por-la-aplicacion',
            momento: new Date('2026-09-15T10:00:00.000Z'),
          });
        });
        expect(resultado.yaEstaba).toBe(false);
        expect(resultado.costeEuros).toBeCloseTo(0.15, 4);
      } finally {
        await aplicacion.cerrar();
      }
    });

    it('dos usos con la misma clave no caben en la base, ni saltándose el código', async () => {
      await expect(
        conTenant(
          cliente,
          org.tenantId,
          (tx) => tx`
            insert into uso_modelo (
              tenant_id, tarea_id, tarea_raiz_id, puesto_id, version_puesto_id,
              proveedor, modelo, tarifa_modelo_id, clave_idempotencia
            ) values (
              ${org.tenantId}, ${org.tareaId}, ${org.tareaId}, ${org.puestoId},
              ${org.versionPuestoId}, ${PROVEEDOR}, ${MODELO}, ${tarifaId}, 'peticion-1'
            )
          `,
        ),
      ).rejects.toThrow(/uso_modelo_tenant_clave_key|duplicate key/i);
    });
  });
});
