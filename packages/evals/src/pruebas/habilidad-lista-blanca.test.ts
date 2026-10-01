/**
 * Lista blanca de herramientas de una habilidad, por el camino real —
 * `sembrarHabilidad` → `proponerActivacionDeHabilidad` → `promocionarLeccion`
 * con `certificarPromocion`, la puerta real del Evaluador, no una `VersionCandidata`
 * construida a mano — contra PostgreSQL.
 *
 * Hallazgo bloqueante del Revisor en el PR #67 («habilidades en el bucle del
 * agente»): la fila `habilidad` no tenía columna `herramientas`, así que
 * `sembrarHabilidad` las descartaba y `proponerActivacionDeHabilidad` las fijaba
 * a `[]`; la puerta certificaba cualquier habilidad sin mirar sus herramientas
 * reales. El único sitio que de verdad ejercitaba ese bloqueo era el eval de
 * humo `habilidad-carga.eval.ts`, con una `VersionCandidata` a mano — daba una
 * falsa sensación de cobertura. Esta prueba cierra ese hueco por el camino real.
 *
 * Necesita base de datos: sin `DATABASE_URL` se salta diciendo por qué, igual
 * que `aprendizaje.test.ts` y `habilidades.test.ts` de `@aiw/learning`.
 */
import { aplicarMigraciones, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import {
  proponerActivacionDeHabilidad,
  promocionarLeccion,
  sembrarHabilidad,
  type DefinicionDeHabilidad,
} from '@aiw/learning';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { certificarPromocion } from '../plataforma/aprendizaje.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'lista blanca de herramientas de una habilidad'
  : `lista blanca de herramientas de una habilidad — SALTADO. ${MOTIVO_SALTO}`;

/** `sembrarOrganizacion` autoriza solo `odoo.buscar_factura` para el puesto. */
const HERRAMIENTA_AUTORIZADA = 'odoo.buscar_factura';
const HERRAMIENTA_FUERA_DE_LISTA = 'odoo.borrar_factura';

function definicion(nombre: string, herramienta: string): DefinicionDeHabilidad {
  return {
    nombre,
    version: 1,
    casosQueAplican: ['buscar una factura por su número'],
    pasos: [`Busca la factura en el ERP con ${herramienta}.`],
    comprobaciones: ['La factura encontrada tiene el mismo número que se pidió.'],
    herramientas: [herramienta],
  };
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(6);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'lista-blanca-habilidad');
  });

  afterAll(async () => {
    if (org) await purgarOrganizacion(cliente, org.tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('certifica una habilidad cuya herramienta está en la lista blanca del puesto', async () => {
    const { habilidadId } = await sembrarHabilidad(
      cliente,
      org.tenantId,
      definicion('prueba.herramienta-autorizada', HERRAMIENTA_AUTORIZADA),
    );
    const propuesta = await proponerActivacionDeHabilidad(cliente, org.tenantId, {
      puestoId: org.puestoId,
      habilidadId,
    });

    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: propuesta.leccionId,
      personaId: org.personaId,
      puerta: certificarPromocion,
    });

    expect(resultado.estado).toBe('promocionada');
  });

  it('bloquea por el camino real una habilidad que nombra una herramienta fuera de la lista blanca', async () => {
    const { habilidadId } = await sembrarHabilidad(
      cliente,
      org.tenantId,
      definicion('prueba.herramienta-fuera-de-lista', HERRAMIENTA_FUERA_DE_LISTA),
    );
    const propuesta = await proponerActivacionDeHabilidad(cliente, org.tenantId, {
      puestoId: org.puestoId,
      habilidadId,
    });

    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: propuesta.leccionId,
      personaId: org.personaId,
      puerta: certificarPromocion,
    });

    expect(resultado.estado).toBe('bloqueada');
    if (resultado.estado === 'bloqueada') {
      expect(resultado.resultados.casos.some((caso) => !caso.superado)).toBe(true);
    }
  });
});
