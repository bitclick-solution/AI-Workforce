/**
 * Aislamiento entre tenants: un conjunto de consultas que intentan leer y escribir
 * fuera del tenant y deben fallar con la seguridad a nivel de fila activa.
 *
 * Las pruebas corren con `set local role aiw_app`, que es el rol de la aplicación:
 * no es superusuario, no es propietario del esquema y no tiene `BYPASSRLS`, así que
 * las políticas se le aplican igual que en producción.
 */
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ROL_APLICACION,
  ROL_MIGRADOR,
  conTenant,
  conTenantYRol,
  identificadorSeguro,
} from '../cliente.js';
import { aplicarMigraciones } from '../migrador.js';
import { purgarOrganizacion } from '../mantenimiento.js';
import { NOMBRES_TABLAS_INMUTABLES, NOMBRES_TABLAS_INMUTABLES_EN_BUCLE } from '../tablas.js';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from './entorno.js';
import { sembrarOrganizacion, type OrganizacionSembrada } from './semilla.js';

/** Una tabla por familia del modelo: equipo, trabajo, aprendizaje, sala, conocimiento. */
const TABLAS_VIGILADAS = [
  'persona',
  'departamento',
  'puesto',
  'version_puesto',
  'tarea',
  'paso',
  'aprobacion',
  'decision_aprobacion',
  'senal',
  'leccion',
  'sala',
  'mensaje',
  'conector',
  'autorizacion_herramientas',
  'memoria',
  'fragmento_conocimiento',
  'entidad',
  'notificacion',
  'evento_salida',
] as const;

const TITULO = HAY_BASE_DE_DATOS
  ? 'aislamiento entre tenants'
  : `aislamiento entre tenants — SALTADO. ${MOTIVO_SALTO}`;

/**
 * Las comprobaciones que no van con `conTenantYRol` corren con el usuario de
 * `DATABASE_URL`, que en desarrollo y en la CI es superusuario y se salta la
 * seguridad de fila: por eso filtran por `tenant_id` a mano.
 */
describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let alfa: OrganizacionSembrada;
  let beta: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    alfa = await sembrarOrganizacion(cliente, 'alfa');
    beta = await sembrarOrganizacion(cliente, 'beta');
  });

  afterAll(async () => {
    if (alfa) await purgarOrganizacion(cliente, alfa.tenantId);
    if (beta) await purgarOrganizacion(cliente, beta.tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('cada tenant solo ve sus propias filas', async () => {
    for (const tabla of TABLAS_VIGILADAS) {
      const nombre = identificadorSeguro(tabla);
      const propias = await conTenantYRol(cliente, alfa.tenantId, ROL_APLICACION, (tx) =>
        tx.unsafe<{ ajenas: string; total: string }[]>(
          `select count(*) filter (where tenant_id <> $1) as ajenas, count(*) as total from ${nombre}`,
          [alfa.tenantId],
        ),
      );
      expect(propias[0]?.ajenas, `${nombre} deja ver filas de otro tenant`).toBe('0');
      expect(Number(propias[0]?.total ?? 0), `${nombre} no tiene filas de alfa`).toBeGreaterThan(0);
    }
  });

  it('una consulta apuntando al otro tenant devuelve cero filas', async () => {
    const filas = await conTenantYRol(
      cliente,
      alfa.tenantId,
      ROL_APLICACION,
      (tx) => tx`select id from persona where tenant_id = ${beta.tenantId}`,
    );
    expect(filas.length).toBe(0);
  });

  it('sin tenant fijado no se ve nada', async () => {
    const filas = await cliente.begin(async (tx) => {
      await tx.unsafe(`set local role ${ROL_APLICACION}`);
      return tx`select id from persona`;
    });
    expect(filas.length).toBe(0);
  });

  it('un tenant inventado tampoco ve nada', async () => {
    const filas = await conTenantYRol(
      cliente,
      '01920000-0000-7000-8000-0000000000ff',
      ROL_APLICACION,
      (tx) => tx`select id from persona`,
    );
    expect(filas.length).toBe(0);
  });

  it('insertar con el tenant de otro falla', async () => {
    await expect(
      conTenantYRol(
        cliente,
        alfa.tenantId,
        ROL_APLICACION,
        (tx) =>
          tx`
          insert into persona (tenant_id, nombre, correo)
          values (${beta.tenantId}, 'Intrusa', 'intrusa@beta.local')
        `,
      ),
    ).rejects.toThrow(/row-level security|seguridad/i);
  });

  it('actualizar una fila del otro tenant no toca nada', async () => {
    const resultado = await conTenantYRol(
      cliente,
      alfa.tenantId,
      ROL_APLICACION,
      (tx) => tx`update persona set nombre = 'Cambiada' where id = ${beta.personaId}`,
    );
    expect(resultado.count).toBe(0);

    const [fila] = await conTenant(
      cliente,
      beta.tenantId,
      (tx) => tx<{ nombre: string }[]>`select nombre from persona where id = ${beta.personaId}`,
    );
    expect(fila?.nombre).toBe('Jesús');
  });

  it('borrar una fila del otro tenant no toca nada', async () => {
    const resultado = await conTenantYRol(
      cliente,
      alfa.tenantId,
      ROL_APLICACION,
      (tx) => tx`delete from memoria where tenant_id = ${beta.tenantId}`,
    );
    expect(resultado.count).toBe(0);

    const restantes = await conTenant(
      cliente,
      beta.tenantId,
      (tx) => tx`select id from memoria where tenant_id = ${beta.tenantId}`,
    );
    expect(restantes.length).toBe(1);
  });

  it('cambiar el tenant_id de una fila propia para regalarla al otro falla', async () => {
    await expect(
      conTenantYRol(
        cliente,
        alfa.tenantId,
        ROL_APLICACION,
        (tx) => tx`update persona set tenant_id = ${beta.tenantId} where id = ${alfa.personaId}`,
      ),
    ).rejects.toThrow(/row-level security|seguridad/i);
  });

  it('la organización solo se ve a sí misma', async () => {
    const filas = await conTenantYRol(
      cliente,
      alfa.tenantId,
      ROL_APLICACION,
      (tx) => tx<{ id: string }[]>`select id from organizacion`,
    );
    expect(filas.map((f) => f.id)).toEqual([alfa.tenantId]);
  });

  it('las particiones no se consultan directamente', async () => {
    await expect(
      conTenantYRol(
        cliente,
        alfa.tenantId,
        ROL_APLICACION,
        (tx) => tx`select count(*) from mensaje_defecto`,
      ),
    ).rejects.toThrow(/permission denied|permiso denegado/i);
  });

  // La inmutabilidad estaba escrita en un comentario del SQL y en una lista del
  // código, pero el `grant` sobre todas las tablas del esquema la dejaba sin efecto.
  // Estas tres pruebas recorren la lista: si alguien añade una tabla inmutable y no
  // la protege en la migración, fallan aquí y no seis meses después en producción.
  describe('las tablas inmutables lo son en la base, no solo en el comentario', () => {
    // El disparador es por fila: sin filas no dispara y la prueba de abajo pasaría
    // sin comprobar nada. `entrada_auditoria` queda fuera porque la semilla no
    // escribe en el libro a propósito; su inmutabilidad la prueba `@aiw/ledger`.
    it('las del bucle tienen filas de alfa, o la prueba del disparador no vale nada', async () => {
      for (const tabla of NOMBRES_TABLAS_INMUTABLES_EN_BUCLE) {
        const nombre = identificadorSeguro(tabla);
        const filas = await conTenant(cliente, alfa.tenantId, (tx) =>
          tx.unsafe<{ total: string }[]>(
            `select count(*) as total from ${nombre} where tenant_id = $1`,
            [alfa.tenantId],
          ),
        );
        expect(Number(filas[0]?.total ?? 0), `${nombre} no tiene filas de alfa`).toBeGreaterThan(0);
      }
    });

    it('el rol de aplicación no puede actualizarlas ni borrarlas', async () => {
      for (const tabla of NOMBRES_TABLAS_INMUTABLES) {
        const nombre = identificadorSeguro(tabla);
        await expect(
          conTenantYRol(cliente, alfa.tenantId, ROL_APLICACION, (tx) =>
            tx.unsafe(`update ${nombre} set creado_en = creado_en where tenant_id = $1`, [
              alfa.tenantId,
            ]),
          ),
          `${nombre} deja al rol de aplicación actualizar`,
        ).rejects.toThrow(/permission denied|permiso denegado/i);

        await expect(
          conTenantYRol(cliente, alfa.tenantId, ROL_APLICACION, (tx) =>
            tx.unsafe(`delete from ${nombre} where tenant_id = $1`, [alfa.tenantId]),
          ),
          `${nombre} deja al rol de aplicación borrar`,
        ).rejects.toThrow(/permission denied|permiso denegado/i);
      }
    });

    it('ni el dueño del esquema las actualiza: el disparador lo impide', async () => {
      for (const tabla of NOMBRES_TABLAS_INMUTABLES_EN_BUCLE) {
        const nombre = identificadorSeguro(tabla);
        await expect(
          conTenantYRol(cliente, alfa.tenantId, ROL_MIGRADOR, (tx) =>
            tx.unsafe(`update ${nombre} set creado_en = creado_en where tenant_id = $1`, [
              alfa.tenantId,
            ]),
          ),
          `${nombre} deja al dueño del esquema actualizar`,
        ).rejects.toThrow(/es inmutable/);
      }
    });

    it('el dueño del esquema sí las borra: la purga y la retención son de plataforma', async () => {
      // Se comprueba sobre una organización que se tira acto seguido, para no dejar
      // a alfa a medias. Si esto fallara, `purgarOrganizacion` no podría funcionar.
      const efimera = await sembrarOrganizacion(cliente, `inmutables-${Date.now()}`);
      const borradas = await purgarOrganizacion(cliente, efimera.tenantId);
      for (const tabla of NOMBRES_TABLAS_INMUTABLES_EN_BUCLE) {
        expect(borradas[tabla], `la purga no borró ${tabla}`).toBeGreaterThan(0);
      }
    });
  });

  it('la tabla de migraciones es del migrador, no de la aplicación', async () => {
    await expect(
      conTenantYRol(
        cliente,
        alfa.tenantId,
        ROL_APLICACION,
        (tx) => tx`select nombre from migracion_aplicada`,
      ),
    ).rejects.toThrow(/permission denied|permiso denegado/i);
  });
});
