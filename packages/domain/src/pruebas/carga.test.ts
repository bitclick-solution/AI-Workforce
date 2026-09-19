/**
 * Carga sintética y banco de consultas del panel.
 *
 * El plan pide un millón de entradas de auditoría y cien mil mensajes de sala en un
 * tenant, con las consultas del panel por debajo de 200 ms en el percentil 95.
 * Por defecto la prueba usa una carga reducida; con `AIW_PRUEBA_CARGA=1` usa la
 * completa y escribe el informe en `bench/informe.md`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { conTenant } from '../db/cliente.js';
import { generarCarga, medirPanel, type MedidaConsulta } from '../db/carga.js';
import { purgarOrganizacion } from '../db/mantenimiento.js';
import { aplicarMigraciones } from '../db/migrador.js';
import {
  ES_CARGA_COMPLETA,
  HAY_BASE_DE_DATOS,
  LIMITE_PANEL_MS,
  MOTIVO_SALTO,
  conectar,
  tamanoDeCarga,
} from './entorno.js';
import { sembrarOrganizacion, type OrganizacionSembrada } from './semilla.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'carga sintética y consultas del panel'
  : `carga sintética y consultas del panel — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let medidas: MedidaConsulta[] = [];
  let versionPostgres = 'desconocida';
  const tamano = tamanoDeCarga();

  beforeAll(async () => {
    cliente = conectar(3);
    await aplicarMigraciones(cliente);
    const [fila] = await cliente<{ version: string }[]>`select version() as version`;
    versionPostgres = fila?.version.split(' ').slice(0, 2).join(' ') ?? 'desconocida';
    org = await sembrarOrganizacion(cliente, `carga-${Date.now()}`);
    await generarCarga(cliente, org.tenantId, {
      entradasAuditoria: tamano.entradasAuditoria,
      mensajes: tamano.mensajes,
      salaId: org.salaId,
      puestoId: org.puestoId,
    });
  }, 900_000);

  afterAll(async () => {
    if (org) {
      await purgarOrganizacion(cliente, org.tenantId);
      await cliente.unsafe('truncate entrada_auditoria');
    }
    await cliente?.end({ timeout: 5 });
  }, 300_000);

  it('inserta la carga pedida', async () => {
    const [auditoria] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ total: string }[]>`
          select count(*) as total from entrada_auditoria where tenant_id = ${org.tenantId}
        `,
    );
    const [mensajes] = await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx<{ total: string }[]>`
          select count(*) as total from mensaje where tenant_id = ${org.tenantId}
        `,
    );
    expect(Number(auditoria?.total)).toBe(tamano.entradasAuditoria);
    // La semilla ya dejó un mensaje en la sala antes de la carga.
    expect(Number(mensajes?.total)).toBe(tamano.mensajes + 1);
  }, 300_000);

  it('las consultas del panel responden por debajo de 200 ms en el percentil 95', async () => {
    medidas = await medirPanel(cliente, org.tenantId, {
      puestoId: org.puestoId,
      salaId: org.salaId,
      personaId: org.personaId,
    });
    expect(medidas.length).toBe(4);
    for (const medida of medidas) {
      expect(
        medida.p95,
        `«${medida.nombre}» tarda ${medida.p95.toFixed(1)} ms en el percentil 95`,
      ).toBeLessThan(LIMITE_PANEL_MS);
    }
  }, 300_000);

  it.skipIf(!ES_CARGA_COMPLETA)('deja el informe de la carga completa en el repositorio', () => {
    const directorio = fileURLToPath(new URL('../../bench/', import.meta.url));
    mkdirSync(directorio, { recursive: true });
    writeFileSync(`${directorio}informe.md`, informe(medidas, tamano, versionPostgres), 'utf8');
    expect(medidas.length).toBe(4);
  });
});

function informe(
  medidas: readonly MedidaConsulta[],
  tamano: { entradasAuditoria: number; mensajes: number },
  versionPostgres: string,
): string {
  const lineas = [
    'VIGENTE',
    '',
    '# Informe de carga · modelo de datos v1',
    '',
    'Lo genera la prueba `packages/domain/src/pruebas/carga.test.ts` con `AIW_PRUEBA_CARGA=1`.',
    'Vuelve a generarlo cuando cambien el esquema, los índices o la versión de PostgreSQL.',
    '',
    `- Fecha: ${new Date().toISOString()}`,
    `- PostgreSQL: ${versionPostgres}`,
    `- Máquina: ${process.platform} ${process.arch}, ${cpus().length} núcleos`,
    `- Entradas de auditoría: ${tamano.entradasAuditoria.toLocaleString('es-ES')}`,
    `- Mensajes de sala: ${tamano.mensajes.toLocaleString('es-ES')}`,
    `- Límite del plan: ${LIMITE_PANEL_MS} ms en el percentil 95`,
    '',
    '## Consultas del panel',
    '',
    '| Consulta | Repeticiones | p50 (ms) | p95 (ms) | Máximo (ms) |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const medida of medidas) {
    lineas.push(
      `| ${medida.nombre} | ${medida.repeticiones} | ${medida.p50.toFixed(2)} | ${medida.p95.toFixed(2)} | ${medida.maximo.toFixed(2)} |`,
    );
  }
  lineas.push('', '## Planes', '');
  for (const medida of medidas) {
    lineas.push(`### ${medida.nombre}`, '', '```', medida.plan, '```', '');
  }
  return lineas.join('\n');
}
