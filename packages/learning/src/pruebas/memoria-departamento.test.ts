/**
 * Memoria compartida de departamento contra PostgreSQL: lección con ámbito
 * departamento → puerta del Evaluador → promoción que deja una versión nueva en cada
 * puesto → reversión por puesto, con el aislamiento entre departamentos y
 * organizaciones comprobado con RLS.
 *
 * Necesita base de datos: sin `DATABASE_URL` se salta diciendo por qué.
 */
import { aplicarMigraciones, conTenant, conTenantYRol, purgarOrganizacion } from '@aiw/db';
import {
  HAY_BASE_DE_DATOS,
  MOTIVO_SALTO,
  conectar,
  sembrarOrganizacion,
  type OrganizacionSembrada,
} from '@aiw/db/pruebas';
import { registrarDecision, solicitarAprobacion } from '@aiw/ledger';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ACCIONES_APRENDIZAJE,
  ErrorDeAprendizaje,
  leerMemoriaCongelada,
  leerMemoriaDeDepartamento,
  lineasDeMemoria,
  promocionarLeccion,
  proponerLeccion,
  puedePromocionarDepartamento,
  registrarSenalDeEdicion,
  revertirVersion,
  versionActivaDe,
  type PuertaDeEvaluacion,
  type ResultadoDeLaPuerta,
  type VersionCandidata,
} from '../index.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'memoria de departamento'
  : `memoria de departamento — SALTADO. ${MOTIVO_SALTO}`;

/** Una edición limpia: sin datos de una persona concreta, que la memoria compartida no admite. */
const ANTES = {
  conector: 'demo',
  argumentos: { factura: 'F-2026-0001', texto: 'Le recordamos que su factura está vencida.' },
};
const DESPUES = {
  conector: 'demo',
  argumentos: {
    factura: 'F-2026-0001',
    texto: 'Te escribo para recordarte que tu factura está vencida.',
  },
};

function certifica(vistas: VersionCandidata[] = []): PuertaDeEvaluacion {
  return (candidata) => {
    vistas.push(candidata);
    return {
      certificada: true,
      evaluador: 'prueba',
      casos: [{ id: 'caso-prueba', superado: true, puntuacion: 1, diagnostico: 'ok' }],
    };
  };
}

const BLOQUEA: PuertaDeEvaluacion = (): ResultadoDeLaPuerta => ({
  certificada: false,
  evaluador: 'prueba',
  casos: [{ id: 'caso-que-falla', superado: false, puntuacion: 0, diagnostico: 'empeora' }],
});

describe('quién promociona la memoria de un departamento', () => {
  const departamento = { supervisorPersonaId: 'persona-supervisora' };

  it('promociona quien supervisa el departamento', () => {
    expect(
      puedePromocionarDepartamento(departamento, { id: 'persona-supervisora', activa: true }),
    ).toBe(true);
  });

  it('promociona un administrador de la organización (hoy, toda persona activa)', () => {
    expect(puedePromocionarDepartamento(departamento, { id: 'otra', activa: true })).toBe(true);
    expect(
      puedePromocionarDepartamento({ supervisorPersonaId: null }, { id: 'x', activa: true }),
    ).toBe(true);
  });

  it('nunca promociona una persona dada de baja, ni siquiera la supervisora', () => {
    expect(
      puedePromocionarDepartamento(departamento, { id: 'persona-supervisora', activa: false }),
    ).toBe(false);
  });
});

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  let cliente: postgres.Sql;
  let org: OrganizacionSembrada;
  let otra: OrganizacionSembrada;
  /** Los tres puestos de Finanzas: el sembrado más dos. */
  let finanzas: { cobros: string; conciliacion: string; prevision: string };
  /** Un puesto de otro departamento de la misma organización. */
  let ventas: string;
  let personaSinSupervisar: string;

  beforeAll(async () => {
    cliente = conectar(8);
    await aplicarMigraciones(cliente);
    org = await sembrarOrganizacion(cliente, 'memoria-departamento');
    otra = await sembrarOrganizacion(cliente, 'memoria-departamento-vecina');

    await conTenant(cliente, org.tenantId, async (tx) => {
      const crear = async (departamentoId: string, nombre: string): Promise<string> => {
        const [puesto] = await tx<{ id: string }[]>`
          insert into puesto (tenant_id, departamento_id, nombre, clase_riesgo, estado)
          values (${org.tenantId}, ${departamentoId}, ${nombre}, 'medio', 'activo')
          returning id
        `;
        const id = puesto?.id ?? '';
        const [version] = await tx<{ id: string }[]>`
          insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
          values (${org.tenantId}, ${id}, 1, ${`Eres ${nombre}.`}, '{"niveles":{"leer":"n3"}}'::jsonb)
          returning id
        `;
        await tx`update puesto set version_activa_id = ${version?.id ?? ''} where id = ${id}`;
        return id;
      };
      const conciliacion = await crear(org.departamentoId, 'Conciliación');
      const prevision = await crear(org.departamentoId, 'Previsión');
      const [departamentoVentas] = await tx<{ id: string }[]>`
        insert into departamento (tenant_id, nombre, estado)
        values (${org.tenantId}, 'Ventas', 'activo') returning id
      `;
      ventas = await crear(departamentoVentas?.id ?? '', 'Comercial');
      finanzas = { cobros: org.puestoId, conciliacion, prevision };
      const [persona] = await tx<{ id: string }[]>`
        insert into persona (tenant_id, nombre, correo)
        values (${org.tenantId}, 'Otra persona', 'otra@memoria-departamento.local')
        returning id
      `;
      personaSinSupervisar = persona?.id ?? '';
    });
  });

  afterAll(async () => {
    for (const sembrada of [org, otra]) {
      if (sembrada) await purgarOrganizacion(cliente, sembrada.tenantId);
    }
    await cliente.unsafe('truncate entrada_auditoria');
    await cliente?.end({ timeout: 5 });
  });

  /** Una edición nueva del puesto sembrado y la lección de departamento que sale de ella. */
  async function proponerDeDepartamento(
    opciones: { categoriaEspecial?: boolean } = {},
  ): Promise<{ leccionId: string }> {
    const solicitada = await conTenant(cliente, org.tenantId, (tx) =>
      solicitarAprobacion(tx, org.tenantId, {
        tareaId: org.tareaId,
        personaId: org.personaId,
        claseAccion: 'comunicar',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'herramienta.redactar_nota', carga: ANTES },
        resumenLegible: 'Nota de seguimiento',
        venceEn: new Date(Date.now() + 86_400_000),
      }),
    );
    await registrarDecision(cliente, org.tenantId, {
      aprobacionId: solicitada.id,
      sentido: 'editada',
      edicionPrevia: { antes: ANTES, despues: DESPUES },
      origen: 'panel',
    });
    const senal = await registrarSenalDeEdicion(cliente, org.tenantId, solicitada.id);
    const leccion = await proponerLeccion(
      cliente,
      org.tenantId,
      { senalId: senal.senalId, senalCreadoEn: senal.senalCreadoEn },
      { ambito: 'departamento', ...opciones },
    );
    expect(leccion).toMatchObject({ ambito: 'departamento', nueva: true });
    return { leccionId: leccion.leccionId };
  }

  async function estadoDe(
    puestoId: string,
  ): Promise<{ id: string; numero: number; memoria: string[]; lecciones: string[] }> {
    return conTenant(cliente, org.tenantId, async (tx) => {
      const activa = await versionActivaDe(tx, org.tenantId, puestoId);
      const [fila] = await tx<{ memoria_congelada: unknown }[]>`
        select memoria_congelada from version_puesto where id = ${activa.versionPuestoId}
      `;
      return {
        id: activa.versionPuestoId,
        numero: activa.numero,
        memoria: lineasDeMemoria(fila?.memoria_congelada),
        lecciones: leerMemoriaCongelada(fila?.memoria_congelada).lineas.map((l) => l.leccionId),
      };
    });
  }

  async function filas<T extends object>(consulta: string, ...params: string[]): Promise<T[]> {
    return conTenant(cliente, org.tenantId, (tx) => tx.unsafe<T[]>(consulta, params));
  }

  async function acciones(tenantId: string): Promise<string[]> {
    const lista = await conTenant(
      cliente,
      tenantId,
      (tx) => tx<{ accion: string }[]>`
        select accion from entrada_auditoria where tenant_id = ${tenantId} order by numero_orden
      `,
    );
    return lista.map((f) => f.accion);
  }

  it('la lección de departamento lleva destino «departamento» y sin datos personales', async () => {
    const { leccionId } = await proponerDeDepartamento();
    const [fila] = await filas<{ parametros: { clase: string; destino: string; valor: string } }>(
      'select parametros from leccion where id = $1',
      leccionId,
    );
    expect(fila?.parametros).toMatchObject({ clase: 'memoria', destino: 'departamento' });
    expect(fila?.parametros.valor).toContain('Te escribo para recordarte');
  });

  it('si la puerta bloquea no hay memoria ni versiones y el libro lo recuerda', async () => {
    const { leccionId } = await proponerDeDepartamento();
    const antes = await Promise.all(Object.values(finanzas).map(estadoDe));
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId,
      personaId: org.personaId,
      puerta: BLOQUEA,
    });
    expect(resultado.estado).toBe('bloqueada');
    expect(await Promise.all(Object.values(finanzas).map(estadoDe))).toEqual(antes);
    const [memoria] = await filas<{ n: string }>(
      `select count(*)::text as n from memoria where clave = $1`,
      `leccion:${leccionId}`,
    );
    expect(memoria?.n).toBe('0');
    const [versiones] = await filas<{ n: string }>(
      'select count(*)::text as n from promocion_version',
    );
    expect(versiones?.n).toBe('0');
    expect(await acciones(org.tenantId)).toContain(ACCIONES_APRENDIZAJE.promocionBloqueada);
  });

  it('una lección marcada como categoría especial llega a la puerta marcada y no deja memoria', async () => {
    const { leccionId } = await proponerDeDepartamento({ categoriaEspecial: true });
    const vistas: VersionCandidata[] = [];
    // Una puerta que aplica la regla de la decisión 6, como la del Evaluador real.
    const puerta: PuertaDeEvaluacion = (candidata) => {
      vistas.push(candidata);
      return candidata.categoriaEspecial ? BLOQUEA(candidata) : certifica()(candidata);
    };
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId,
      personaId: org.personaId,
      puerta,
    });
    expect(resultado.estado).toBe('bloqueada');
    expect(vistas[0]).toMatchObject({ ambito: 'departamento', categoriaEspecial: true });
    const [memoria] = await filas<{ n: string }>(
      `select count(*)::text as n from memoria where clave = $1`,
      `leccion:${leccionId}`,
    );
    expect(memoria?.n).toBe('0');
  });

  it('certificada y promocionada, los tres puestos de Finanzas tienen una versión nueva con la línea', async () => {
    const { leccionId } = await proponerDeDepartamento();
    const antes = await Promise.all(Object.values(finanzas).map(estadoDe));
    const vistas: VersionCandidata[] = [];
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId,
      personaId: org.personaId,
      puerta: certifica(vistas),
    });
    if (resultado.estado !== 'promocionada') throw new Error('Debía promocionarse.');

    // La puerta se pasó una vez por puesto, y cada candidata lleva el ámbito.
    expect(vistas.map((v) => v.puestoId).sort()).toEqual(Object.values(finanzas).sort());
    expect(vistas.every((v) => v.ambito === 'departamento')).toBe(true);

    const despues = await Promise.all(Object.values(finanzas).map(estadoDe));
    despues.forEach((estado, i) => {
      expect(estado.numero, 'una versión nueva por puesto').toBeGreaterThan(antes[i]?.numero ?? 0);
      expect(estado.lecciones).toContain(leccionId);
      expect(estado.memoria.some((l) => l.includes('Te escribo para recordarte'))).toBe(true);
    });
    expect(resultado.versiones).toHaveLength(3);
    expect(resultado.versiones.find((v) => v.puestoId === org.puestoId)?.versionPuestoId).toBe(
      resultado.versionPuestoId,
    );

    // Una fila de la tabla nueva por puesto, y la promoción apunta a la del origen.
    const filasVersion = await filas<{ puesto_id: string; version_puesto_id: string }>(
      'select puesto_id, version_puesto_id from promocion_version where promocion_id = $1',
      resultado.promocionId,
    );
    expect(filasVersion.map((f) => f.puesto_id).sort()).toEqual(Object.values(finanzas).sort());
    const [promocion] = await filas<{ version_puesto_resultante_id: string }>(
      'select version_puesto_resultante_id from promocion where id = $1',
      resultado.promocionId,
    );
    expect(promocion?.version_puesto_resultante_id).toBe(resultado.versionPuestoId);

    // Una sola fila de memoria viva, de ámbito departamento.
    const memoria = await filas<{ ambito: string; ambito_id: string; categoria_especial: boolean }>(
      `select ambito, ambito_id, categoria_especial from memoria where clave = $1`,
      `leccion:${leccionId}`,
    );
    expect(memoria).toEqual([
      { ambito: 'departamento', ambito_id: org.departamentoId, categoria_especial: false },
    ]);

    // El libro: una entrada por puesto, con la lección aplicada.
    const [libro] = await filas<{ n: string }>(
      `select count(*)::text as n from entrada_auditoria
       where accion = $1 and leccion_aplicada_id = $2`,
      ACCIONES_APRENDIZAJE.leccionPromocionada,
      leccionId,
    );
    expect(libro?.n).toBe('3');

    // Una segunda promoción de la misma lección no deja nada más.
    await expect(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId,
        personaId: org.personaId,
        puerta: certifica(),
      }),
    ).rejects.toMatchObject({ codigo: 'ya_promocionada' });
    expect((await Promise.all(Object.values(finanzas).map(estadoDe))).map((e) => e.numero)).toEqual(
      despues.map((e) => e.numero),
    );
  });

  it('la promoción es atómica: si falla al crear la tercera versión no queda ninguna', async () => {
    const { leccionId } = await proponerDeDepartamento();
    const antes = await Promise.all(Object.values(finanzas).map(estadoDe));
    // Un disparador solo de esta organización que rechaza la fila del puesto de Previsión,
    // la última en insertarse, cuando ya están hechas las otras dos versiones.
    const disparador = `fallar_${org.tenantId.replaceAll('-', '')}`;
    await cliente.unsafe(`
      create function ${disparador}() returns trigger language plpgsql as $$
      begin
        if new.tenant_id = '${org.tenantId}' and new.puesto_id = '${finanzas.prevision}' then
          raise exception 'fallo provocado por la prueba';
        end if;
        return new;
      end $$;
    `);
    await cliente.unsafe(
      `create trigger ${disparador} before insert on promocion_version
       for each row execute function ${disparador}()`,
    );
    try {
      await expect(
        promocionarLeccion(cliente, org.tenantId, {
          leccionId,
          personaId: org.personaId,
          puerta: certifica(),
        }),
      ).rejects.toThrow(/fallo provocado/);
    } finally {
      await cliente.unsafe(`drop trigger ${disparador} on promocion_version`);
      await cliente.unsafe(`drop function ${disparador}()`);
    }
    expect(await Promise.all(Object.values(finanzas).map(estadoDe))).toEqual(antes);
    const [promocion] = await filas<{ n: string }>(
      'select count(*)::text as n from promocion where leccion_id = $1',
      leccionId,
    );
    expect(promocion?.n).toBe('0');
    const [memoria] = await filas<{ n: string }>(
      'select count(*)::text as n from memoria where clave = $1',
      `leccion:${leccionId}`,
    );
    expect(memoria?.n).toBe('0');
  });

  it('promociona quien supervisa o un administrador; una persona de otra organización, no', async () => {
    const { leccionId } = await proponerDeDepartamento();
    // La persona de la otra organización no existe aquí: la RLS no la deja ver.
    await expect(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId,
        personaId: otra.personaId,
        puerta: certifica(),
      }),
    ).rejects.toMatchObject({ codigo: 'sin_persona' });
    // Una persona dada de baja no promociona.
    await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx`update persona set activa = false where id = ${personaSinSupervisar}`,
    );
    await expect(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId,
        personaId: personaSinSupervisar,
        puerta: certifica(),
      }),
    ).rejects.toMatchObject({ codigo: 'sin_permiso' });
    await conTenant(
      cliente,
      org.tenantId,
      (tx) => tx`update persona set activa = true where id = ${personaSinSupervisar}`,
    );
    // Un administrador que no supervisa el departamento promociona, y el rastro lo dice.
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId,
      personaId: personaSinSupervisar,
      puerta: certifica(),
    });
    expect(resultado.estado).toBe('promocionada');
    const [promocion] = await filas<{ evidencia: { permiso: string } }>(
      'select evidencia from promocion where leccion_id = $1',
      leccionId,
    );
    expect(promocion?.evidencia.permiso).toBe('administrador');
  });

  it('un puesto de otro departamento y otra organización no leen la memoria de Finanzas', async () => {
    // Las promociones de las pruebas anteriores dejaron memoria de departamento en Finanzas.
    const enFinanzas = await leerMemoriaDeDepartamento(
      cliente,
      org.tenantId,
      finanzas.conciliacion,
    );
    expect(enFinanzas.length).toBeGreaterThan(0);

    // Otro departamento de la misma organización: ni la lee ni la tiene en su versión.
    expect(await leerMemoriaDeDepartamento(cliente, org.tenantId, ventas)).toEqual([]);
    expect((await estadoDe(ventas)).memoria).toEqual([]);

    // Otra organización: la consulta con su tenant no encuentra el puesto de Finanzas...
    expect(await leerMemoriaDeDepartamento(cliente, otra.tenantId, finanzas.cobros)).toEqual([]);
    // ...y por RLS no ve ni una fila de memoria de departamento de esta.
    const vistas = await conTenantYRol(
      cliente,
      otra.tenantId,
      'aiw_app',
      (tx) => tx<{ id: string }[]>`select id from memoria where ambito_id = ${org.departamentoId}`,
    );
    expect(vistas).toEqual([]);
    const versiones = await conTenantYRol(
      cliente,
      otra.tenantId,
      'aiw_app',
      (tx) => tx<{ id: string }[]>`select id from promocion_version`,
    );
    expect(versiones).toEqual([]);
  });

  it('revertir un puesto retira la línea de ese puesto y deja las demás versiones intactas', async () => {
    const { leccionId } = await proponerDeDepartamento();
    const antes = await Promise.all(Object.values(finanzas).map(estadoDe));
    const promocion = await promocionarLeccion(cliente, org.tenantId, {
      leccionId,
      personaId: org.personaId,
      puerta: certifica(),
    });
    if (promocion.estado !== 'promocionada') throw new Error('Debía promocionarse.');
    // Conciliación vuelve a la versión anterior.
    const deConciliacion = promocion.versiones.find((v) => v.puestoId === finanzas.conciliacion);
    const reversion = await revertirVersion(cliente, org.tenantId, {
      puestoId: finanzas.conciliacion,
      aVersionId: deConciliacion?.versionAnteriorId ?? '',
      personaId: org.personaId,
    });
    expect(reversion.retiradas).toEqual([leccionId]);

    const conciliacion = await estadoDe(finanzas.conciliacion);
    expect(conciliacion.id).toBe(deConciliacion?.versionAnteriorId);
    expect(conciliacion.lecciones).not.toContain(leccionId);
    // Cobros y Previsión conservan su versión nueva, con la línea.
    for (const puestoId of [finanzas.cobros, finanzas.prevision]) {
      const estado = await estadoDe(puestoId);
      const esperada = promocion.versiones.find((v) => v.puestoId === puestoId);
      expect(estado.id).toBe(esperada?.versionPuestoId);
      expect(estado.lecciones).toContain(leccionId);
    }
    // Las versiones antiguas y la nueva de Conciliación siguen ahí, inmutables.
    const [versiones] = await filas<{ n: string }>(
      'select count(*)::text as n from version_puesto where puesto_id = $1',
      finanzas.conciliacion,
    );
    expect(Number(versiones?.n)).toBeGreaterThanOrEqual((antes[1]?.numero ?? 0) + 1);

    // La memoria viva sigue: otros puestos la conservan.
    const [viva0] = await filas<{ caduca_en: string | null }>(
      'select caduca_en from memoria where clave = $1',
      `leccion:${leccionId}`,
    );
    expect(viva0?.caduca_en).toBeNull();

    // Cuando el último puesto la retira, caduca; y vuelve si un puesto la recupera.
    for (const puestoId of [finanzas.cobros, finanzas.prevision]) {
      const nueva = promocion.versiones.find((v) => v.puestoId === puestoId);
      await revertirVersion(cliente, org.tenantId, {
        puestoId,
        aVersionId: nueva?.versionAnteriorId ?? '',
        personaId: org.personaId,
      });
    }
    const [viva] = await filas<{ caduca_en: string | null }>(
      'select caduca_en from memoria where clave = $1',
      `leccion:${leccionId}`,
    );
    expect(viva?.caduca_en).not.toBeNull();
    await revertirVersion(cliente, org.tenantId, {
      puestoId: finanzas.conciliacion,
      aVersionId: deConciliacion?.versionPuestoId ?? '',
      personaId: org.personaId,
    });
    const [recuperada] = await filas<{ caduca_en: string | null }>(
      'select caduca_en from memoria where clave = $1',
      `leccion:${leccionId}`,
    );
    expect(recuperada?.caduca_en).toBeNull();
  });

  it('la tabla de versiones de promoción es inmutable para el rol de aplicación', async () => {
    await expect(
      conTenantYRol(
        cliente,
        org.tenantId,
        'aiw_app',
        (tx) => tx`update promocion_version set creado_en = now()`,
      ),
    ).rejects.toThrow(/permission denied|permiso/i);
    await expect(
      conTenantYRol(cliente, org.tenantId, 'aiw_app', (tx) => tx`delete from promocion_version`),
    ).rejects.toThrow(/permission denied|permiso/i);
    // Ni el dueño del esquema actualiza en sitio: lo impide el disparador.
    await expect(
      conTenant(cliente, org.tenantId, (tx) => tx`update promocion_version set creado_en = now()`),
    ).rejects.toThrow(/inmutable/);
  });

  it('una lección de puesto se promociona como siempre, sin filas en la tabla nueva', async () => {
    const solicitada = await conTenant(cliente, org.tenantId, (tx) =>
      solicitarAprobacion(tx, org.tenantId, {
        tareaId: org.tareaId,
        personaId: org.personaId,
        claseAccion: 'comunicar',
        nivelExigido: 'n1',
        borradorOpaco: { tipo: 'herramienta.redactar_nota', carga: ANTES },
        resumenLegible: 'Nota',
        venceEn: new Date(Date.now() + 86_400_000),
      }),
    );
    await registrarDecision(cliente, org.tenantId, {
      aprobacionId: solicitada.id,
      sentido: 'editada',
      edicionPrevia: { antes: ANTES, despues: DESPUES },
      origen: 'panel',
    });
    const senal = await registrarSenalDeEdicion(cliente, org.tenantId, solicitada.id);
    const leccion = await proponerLeccion(cliente, org.tenantId, {
      senalId: senal.senalId,
      senalCreadoEn: senal.senalCreadoEn,
    });
    expect(leccion.ambito).toBe('puesto');
    const resultado = await promocionarLeccion(cliente, org.tenantId, {
      leccionId: leccion.leccionId,
      personaId: org.personaId,
      puerta: certifica(),
    });
    if (resultado.estado !== 'promocionada') throw new Error('Debía promocionarse.');
    expect(resultado.versiones).toHaveLength(1);
    const [n] = await filas<{ n: string }>(
      'select count(*)::text as n from promocion_version where promocion_id = $1',
      resultado.promocionId,
    );
    expect(n?.n).toBe('0');
    await expect(
      promocionarLeccion(cliente, org.tenantId, {
        leccionId: leccion.leccionId,
        personaId: org.personaId,
        puerta: certifica(),
      }),
    ).rejects.toBeInstanceOf(ErrorDeAprendizaje);
  });
});
