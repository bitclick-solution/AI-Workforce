/**
 * Ensayo de purga y exportación de un agente y de una organización completos.
 *
 * Vive en `@aiw/ledger` porque necesita entradas de auditoría reales, y las
 * entradas solo las escribe el punto único de escritura de este paquete.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  aplicarMigraciones,
  conTenant,
  exportarOrganizacion,
  exportarPuesto,
  purgarOrganizacion,
  purgarPuesto,
} from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { anotar, leerCadena } from '../libro.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'purga y exportación'
  : `purga y exportación — SALTADO. ${MOTIVO_SALTO}`;

/** Tablas que después de purgar la organización tienen que quedar a cero. */
const TABLAS_QUE_SE_VACIAN = [
  'organizacion',
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
  'promocion',
  'sala',
  'mensaje',
  'conector',
  'memoria',
  'entidad',
  'notificacion',
  'evento_salida',
  'contador_consumo',
] as const;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let directorio: string;

  beforeAll(async () => {
    cliente = conectar(4);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'purga');
    directorio = mkdtempSync(join(tmpdir(), 'aiw-export-'));

    for (let i = 0; i < 5; i += 1) {
      await conTenant(cliente, org.tenantId, (tx) =>
        anotar(tx, org.tenantId, {
          actorTipo: 'agente',
          puestoId: org.puestoId,
          tareaId: org.tareaId,
          accion: `accion.${i}`,
          resultado: 'exito',
          costeEuros: 0.01,
        }),
      );
    }
  });

  afterAll(async () => {
    await cliente?.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  it('exporta el expediente del agente con su rastro de auditoría', async () => {
    const ficheros = await exportarPuesto(
      cliente,
      org.tenantId,
      org.puestoId,
      join(directorio, 'agente'),
    );
    const porTabla = new Map(ficheros.map((f) => [f.tabla, f]));
    expect(porTabla.get('puesto')?.filas).toBe(1);
    expect(porTabla.get('version_puesto')?.filas).toBe(2);
    expect(porTabla.get('entrada_auditoria')?.filas).toBe(5);

    const linea = readFileSync(porTabla.get('puesto')?.ruta ?? '', 'utf8').split('\n')[0] ?? '';
    expect(JSON.parse(linea)).toMatchObject({ id: org.puestoId, nombre: 'Contable' });
  });

  it('exporta la organización entera a un JSONL por tabla', async () => {
    const ficheros = await exportarOrganizacion(cliente, org.tenantId, join(directorio, 'org'));
    const porTabla = new Map(ficheros.map((f) => [f.tabla, f]));
    expect(porTabla.get('organizacion')?.filas).toBe(1);
    expect(porTabla.get('persona')?.filas).toBe(1);
    expect(porTabla.get('entrada_auditoria')?.filas).toBe(5);
    // Una tabla por cada paso del orden de purga, más el libro.
    expect(ficheros.length).toBeGreaterThanOrEqual(35);
  });

  it('purgar en el orden equivocado falla por el borrado restringido', async () => {
    await expect(
      conTenant(cliente, org.tenantId, (tx) => tx`delete from organizacion`),
    ).rejects.toThrow(/viola la llave foránea|violates foreign key/i);
  });

  it('da de baja el agente y deja el libro intacto', async () => {
    const antes = (await leerCadena(cliente, org.tenantId)).length;
    const { borradas } = await purgarPuesto(cliente, org.tenantId, org.puestoId);
    expect(borradas['decision_aprobacion']).toBe(1);
    expect(borradas['aprobacion']).toBe(2);
    expect(borradas['puesto']).toBe(1);
    expect(borradas['version_puesto']).toBe(2);
    expect(borradas['tarea']).toBe(2);

    const [fila] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ total: string }[]>`
        select count(*) as total from puesto where tenant_id = ${org.tenantId}
      `,
    );
    expect(fila?.total).toBe('0');
    expect((await leerCadena(cliente, org.tenantId)).length).toBe(antes);
  });

  it('purga la organización y deja cero filas salvo en el libro', async () => {
    await purgarOrganizacion(cliente, org.tenantId);

    for (const tabla of TABLAS_QUE_SE_VACIAN) {
      const columna = tabla === 'organizacion' ? 'id' : 'tenant_id';
      const filas = await cliente.unsafe<{ total: string }[]>(
        `select count(*) as total from ${tabla} where ${columna} = $1`,
        [org.tenantId],
      );
      expect(filas[0]?.total, `${tabla} conserva filas después de purgar`).toBe('0');
    }

    // El libro sobrevive: referencia por identificador, no por clave foránea.
    expect((await leerCadena(cliente, org.tenantId)).length).toBe(5);
  });
});
