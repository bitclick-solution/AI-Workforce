import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, conectar } from '@aiw/db/pruebas';
import { verificarCadenaEnBase } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import { ACCION_PUESTO_ACTIVADO, activarPuestoDeCobros } from './activacion.js';
import { sembrarBitclick, type ResultadoSiembra } from './siembra.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'activarPuestoDeCobros (contra PostgreSQL real)'
  : `activarPuestoDeCobros (contra PostgreSQL real) — SALTADO. ${MOTIVO_SALTO}`;

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql | undefined;
  let raiz: string | undefined;

  afterEach(async () => {
    await cliente?.end();
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  async function sembrarDeUsarYTirar(): Promise<{
    cliente: postgres.Sql;
    estado: ResultadoSiembra;
  }> {
    const clienteNuevo = conectar();
    cliente = clienteNuevo;
    raiz = mkdtempSync(join(tmpdir(), 'aiw-bitclick-activar-'));
    writeFileSync(join(raiz, 'pnpm-workspace.yaml'), '');
    const estado = await sembrarBitclick(clienteNuevo, { raiz });
    return { cliente: clienteNuevo, estado };
  }

  it('pasa el puesto de en_prueba a activo y deja su entrada en el libro', async () => {
    const { cliente: db, estado } = await sembrarDeUsarYTirar();

    const resultado = await activarPuestoDeCobros(db, estado);
    expect(resultado).toEqual({ activado: true, estadoPrevio: 'en_prueba' });

    const [fila] = await conTenant(
      db,
      estado.tenantId,
      (tx) =>
        tx<
          { estado: string }[]
        >`select estado::text as estado from puesto where id = ${estado.puestoId}`,
    );
    expect(fila?.estado).toBe('activo');

    const [entrada] = await conTenant(
      db,
      estado.tenantId,
      (tx) =>
        tx<{ accion: string }[]>`
          select accion from entrada_auditoria
          where tenant_id = ${estado.tenantId} and accion = ${ACCION_PUESTO_ACTIVADO}
        `,
    );
    expect(entrada?.accion).toBe(ACCION_PUESTO_ACTIVADO);

    const verificacion = await conTenant(db, estado.tenantId, (tx) =>
      verificarCadenaEnBase(tx, estado.tenantId),
    );
    expect(verificacion.valida).toBe(true);
  });

  it('es segura de repetir: la segunda vez no toca nada', async () => {
    const { cliente: db, estado } = await sembrarDeUsarYTirar();
    await activarPuestoDeCobros(db, estado);

    const segunda = await activarPuestoDeCobros(db, estado);
    expect(segunda).toEqual({ activado: false, estadoPrevio: 'activo' });

    const [fila] = await conTenant(
      db,
      estado.tenantId,
      (tx) =>
        tx<{ total: string }[]>`
          select count(*)::text as total from entrada_auditoria
          where tenant_id = ${estado.tenantId} and accion = ${ACCION_PUESTO_ACTIVADO}
        `,
    );
    expect(fila?.total).toBe('1');
  });
});
