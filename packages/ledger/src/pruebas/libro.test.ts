/**
 * El libro de auditoría: encadenado, append-only y con el contador cuadrado.
 *
 * Necesita PostgreSQL: sin `DATABASE_URL` estas pruebas se saltan con un mensaje.
 */
import {
  ROL_APLICACION,
  aplicarMigraciones,
  conTenant,
  conTenantYRol,
  purgarOrganizacion,
} from '@aiw/domain/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/domain/pruebas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HASH_GENESIS } from '../hash.js';
import { anotar, leerCadena, verificarCadenaEnBase } from '../libro.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'libro de auditoría'
  : `libro de auditoría — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(6);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'libro');
  });

  afterAll(async () => {
    if (org) {
      await purgarOrganizacion(cliente, org.tenantId);
      // El libro no se borra fila a fila ni en las pruebas: el disparador lo impide.
      // La única vía es soltar la tabla o sus particiones, que es lo que hace la retención.
      await cliente.unsafe('truncate entrada_auditoria');
    }
    await cliente?.end({ timeout: 5 });
  });

  it('la primera entrada encadena con el génesis', async () => {
    const anotada = await conTenant(cliente, org.tenantId, (tx) =>
      anotar(
        tx,
        org.tenantId,
        {
          actorTipo: 'agente',
          puestoId: org.puestoId,
          versionPuestoId: org.versionPuestoId,
          tareaId: org.tareaId,
          accion: 'odoo.buscar_factura',
          herramienta: 'odoo',
          datosReferenciados: [{ tipo: 'factura', id: '2026-001', sistema: 'odoo' }],
          resultado: 'exito',
          costeEuros: 0.0042,
          duracionMs: 320,
          nivelAplicado: 'n3',
        },
        { tareas: 1 },
      ),
    );
    expect(anotada.numeroOrden).toBe(1);
    expect(anotada.hashAnterior).toBe(HASH_GENESIS);
    expect(anotada.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('las siguientes encadenan con la anterior y la cadena verifica', async () => {
    for (let i = 0; i < 9; i += 1) {
      await conTenant(cliente, org.tenantId, (tx) =>
        anotar(
          tx,
          org.tenantId,
          {
            actorTipo: 'agente',
            puestoId: org.puestoId,
            accion: `paso.${i}`,
            resultado: 'exito',
            costeEuros: 0.001,
            duracionMs: 10,
          },
          { pasos: 1 },
        ),
      );
    }
    const cadena = await leerCadena(cliente, org.tenantId);
    expect(cadena.length).toBe(10);
    expect(cadena.map((e) => e.numeroOrden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await verificarCadenaEnBase(cliente, org.tenantId)).valida).toBe(true);
  });

  it('el contador cuadra con lo anotado', async () => {
    const [contador] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ tareas: string; pasos: string; acciones: string; coste_euros: string }[]>`
        select tareas, pasos, acciones, coste_euros
        from contador_consumo
        where tenant_id = ${org.tenantId} and periodo = date_trunc('month', now())::date
      `,
    );
    // La semilla dejó 2 tareas, 1 paso y 0 acciones; el libro añadió 1 tarea, 9 pasos, 10 acciones.
    expect(contador?.acciones).toBe('10');
    expect(contador?.tareas).toBe('3');
    expect(contador?.pasos).toBe('10');
    expect(Number(contador?.coste_euros)).toBeCloseTo(0.0132, 4);
  });

  it('dos escrituras a la vez no se pisan el número de orden', async () => {
    const antes = (await leerCadena(cliente, org.tenantId)).length;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        conTenant(cliente, org.tenantId, (tx) =>
          anotar(tx, org.tenantId, {
            actorTipo: 'agente',
            accion: `concurrente.${i}`,
            resultado: 'exito',
          }),
        ),
      ),
    );
    const cadena = await leerCadena(cliente, org.tenantId);
    expect(cadena.length).toBe(antes + 8);
    expect(new Set(cadena.map((e) => e.numeroOrden)).size).toBe(cadena.length);
    expect((await verificarCadenaEnBase(cliente, org.tenantId)).valida).toBe(true);
  });

  it('el rol de aplicación no puede actualizar el libro', async () => {
    await expect(
      conTenantYRol(
        cliente,
        org.tenantId,
        ROL_APLICACION,
        (tx) =>
          tx`update entrada_auditoria set accion = 'falsificada' where tenant_id = ${org.tenantId}`,
      ),
    ).rejects.toThrow(/permission denied|permiso denegado/i);
  });

  it('el rol de aplicación no puede borrar del libro', async () => {
    await expect(
      conTenantYRol(
        cliente,
        org.tenantId,
        ROL_APLICACION,
        (tx) => tx`delete from entrada_auditoria where tenant_id = ${org.tenantId}`,
      ),
    ).rejects.toThrow(/permission denied|permiso denegado/i);
  });

  it('ni siquiera el propietario del esquema altera una entrada: el disparador lo impide', async () => {
    await expect(
      cliente`update entrada_auditoria set accion = 'falsificada' where tenant_id = ${org.tenantId}`,
    ).rejects.toThrow(/append-only/);
    await expect(
      cliente`delete from entrada_auditoria where tenant_id = ${org.tenantId} and numero_orden = 1`,
    ).rejects.toThrow(/append-only/);
  });

  it('el rol de aplicación sí puede anotar', async () => {
    const anotada = await conTenantYRol(cliente, org.tenantId, ROL_APLICACION, (tx) =>
      anotar(tx, org.tenantId, {
        actorTipo: 'plataforma',
        accion: 'politica.evaluada',
        resultado: 'exito',
      }),
    );
    expect(anotada.numeroOrden).toBeGreaterThan(1);
  });

  it('la verificación detecta una entrada alterada', async () => {
    // El disparador impide el UPDATE: para simular la alteración se deshabilita,
    // se rompe una entrada y se vuelve a habilitar. Es la única vía, y solo la
    // tiene el propietario del esquema.
    await cliente`alter table entrada_auditoria disable trigger entrada_auditoria_sin_actualizar`;
    try {
      await cliente`
        update entrada_auditoria set accion = 'falsificada'
        where tenant_id = ${org.tenantId} and numero_orden = 2
      `;
      const resultado = await verificarCadenaEnBase(cliente, org.tenantId);
      expect(resultado.valida).toBe(false);
      expect(resultado.rotaEn).toBe(2);
      expect(resultado.motivo).toMatch(/alterada/);
    } finally {
      await cliente`alter table entrada_auditoria enable trigger entrada_auditoria_sin_actualizar`;
    }
  });

  it('un tenant no ve el libro de otro', async () => {
    const otro = await sembrarOrganizacion(cliente, 'libro-ajeno');
    try {
      const filas = await conTenantYRol(
        cliente,
        otro.tenantId,
        ROL_APLICACION,
        (tx) => tx`select id from entrada_auditoria`,
      );
      expect(filas.length).toBe(0);
    } finally {
      await purgarOrganizacion(cliente, otro.tenantId);
    }
  });
});
