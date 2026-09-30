/**
 * Habilidades en el bucle del agente contra PostgreSQL: siembra → propuesta de
 * activación → promoción por la puerta del Evaluador → versión nueva del puesto.
 *
 * Necesita base de datos: sin `DATABASE_URL` se salta diciendo por qué, igual que
 * `aprendizaje.test.ts`.
 */
import { aplicarMigraciones, conTenant, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ErrorDeAprendizaje,
  buscarHabilidadCongelada,
  lineasDeHabilidades,
  proponerActivacionDeHabilidad,
  promocionarLeccion,
  sembrarHabilidad,
  versionActivaDe,
  type DefinicionDeHabilidad,
  type PuertaDeEvaluacion,
  type ResultadoDeLaPuerta,
  type VersionCandidata,
} from '../index.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'habilidades en el bucle'
  : `habilidades en el bucle — SALTADO. ${MOTIVO_SALTO}`;

const DEFINICION: DefinicionDeHabilidad = {
  nombre: 'prueba.buscar-factura',
  version: 1,
  casosQueAplican: ['buscar una factura por su número'],
  pasos: ['Busca la factura en el ERP por su número.'],
  comprobaciones: ['La factura encontrada tiene el mismo número que se pidió.'],
  herramientas: ['odoo.buscar_factura'],
};

/** Puerta que certifica cualquier candidata, y registra la última que recibió. */
function puertaQueCertificaYRegistra(): {
  puerta: PuertaDeEvaluacion;
  ultima: () => VersionCandidata | undefined;
} {
  let ultima: VersionCandidata | undefined;
  const puerta: PuertaDeEvaluacion = (candidata) => {
    ultima = candidata;
    return { certificada: true, evaluador: 'prueba', casos: [] };
  };
  return { puerta, ultima: () => ultima };
}

const BLOQUEA: PuertaDeEvaluacion = (): ResultadoDeLaPuerta => ({
  certificada: false,
  evaluador: 'prueba',
  casos: [{ id: 'caso-que-falla', superado: false, puntuacion: 0, diagnostico: 'no aplica' }],
});

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;

  beforeAll(async () => {
    cliente = conectar(6);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'habilidades');
  });

  afterAll(async () => {
    if (org) await purgarOrganizacion(cliente, org.tenantId);
    await cliente?.end({ timeout: 5 });
  });

  it('siembra la habilidad una sola vez aunque se llame dos veces', async () => {
    const primera = await sembrarHabilidad(cliente, org.tenantId, DEFINICION);
    expect(primera.nueva).toBe(true);
    const segunda = await sembrarHabilidad(cliente, org.tenantId, DEFINICION);
    expect(segunda.nueva).toBe(false);
    expect(segunda.habilidadId).toBe(primera.habilidadId);
  });

  it('propone la activación, la promueve y la versión nueva lleva la habilidad congelada', async () => {
    const { habilidadId } = await sembrarHabilidad(cliente, org.tenantId, DEFINICION);
    const propuesta = await proponerActivacionDeHabilidad(cliente, org.tenantId, {
      puestoId: org.puestoId,
      habilidadId,
    });
    expect(propuesta.nueva).toBe(true);

    const { puerta, ultima } = puertaQueCertificaYRegistra();
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: propuesta.leccionId,
      personaId: org.personaId,
      puerta,
    });
    expect(resultado.estado).toBe('promocionada');
    if (resultado.estado !== 'promocionada') return;

    // La puerta recibió la habilidad candidata y la lista blanca del puesto: la
    // semilla de `@aiw/db/pruebas` autoriza `odoo.buscar_factura` (decisión 4).
    const candidata = ultima();
    expect(candidata?.listaBlancaHerramientas).toContain('odoo.buscar_factura');
    const nueva = candidata?.habilidadesCongeladas?.find((h) => h.nombre === DEFINICION.nombre);
    expect(nueva?.pasos).toEqual(DEFINICION.pasos);

    const activa = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    expect(activa.versionPuestoId).toBe(resultado.versionPuestoId);

    const [fila] = await conTenant(
      cliente,
      org.tenantId,
      (tx) =>
        tx<{ habilidades_congeladas: unknown }[]>`
          select habilidades_congeladas from version_puesto
          where tenant_id = ${org.tenantId} and id = ${resultado.versionPuestoId}
        `,
    );
    const congeladas = lineasDeHabilidades(fila?.habilidades_congeladas);
    expect(congeladas.some((linea) => linea.startsWith(DEFINICION.nombre))).toBe(true);
    expect(
      buscarHabilidadCongelada(fila?.habilidades_congeladas, DEFINICION.nombre)?.comprobaciones,
    ).toEqual(DEFINICION.comprobaciones);
  });

  it('una activación bloqueada por la puerta no crea versión nueva', async () => {
    const definicion: DefinicionDeHabilidad = { ...DEFINICION, nombre: 'prueba.bloqueada' };
    const { habilidadId } = await sembrarHabilidad(cliente, org.tenantId, definicion);
    const propuesta = await proponerActivacionDeHabilidad(cliente, org.tenantId, {
      puestoId: org.puestoId,
      habilidadId,
    });

    const antes = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: propuesta.leccionId,
      personaId: org.personaId,
      puerta: BLOQUEA,
    });
    expect(resultado.estado).toBe('bloqueada');

    const despues = await conTenant(cliente, org.tenantId, (tx) =>
      versionActivaDe(tx, org.tenantId, org.puestoId),
    );
    expect(despues.versionPuestoId).toBe(antes.versionPuestoId);
  });

  it('una habilidad ya activa en la versión no se vuelve a activar', async () => {
    const definicion: DefinicionDeHabilidad = { ...DEFINICION, nombre: 'prueba.repetida' };
    const { habilidadId } = await sembrarHabilidad(cliente, org.tenantId, definicion);
    const { puerta } = puertaQueCertificaYRegistra();

    const primera = await proponerActivacionDeHabilidad(cliente, org.tenantId, {
      puestoId: org.puestoId,
      habilidadId,
    });
    const promocionada = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: primera.leccionId,
      personaId: org.personaId,
      puerta,
    });
    expect(promocionada.estado).toBe('promocionada');

    // Proponer otra vez la misma habilidad para el mismo puesto, ya promocionada,
    // es un error esperado: no hay una segunda lección pendiente que promocionar.
    await expect(
      proponerActivacionDeHabilidad(cliente, org.tenantId, {
        puestoId: org.puestoId,
        habilidadId,
      }),
    ).rejects.toThrow(ErrorDeAprendizaje);
  });
});
