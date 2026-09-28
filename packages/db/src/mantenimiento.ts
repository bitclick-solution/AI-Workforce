/**
 * Borrado y exportación como operaciones de primera clase (ADR-007).
 *
 * Dar de baja un agente o una organización no es un `DELETE` suelto: es una
 * secuencia con orden, que respeta el borrado restringido de las claves foráneas
 * y que deja el libro de auditoría intacto. Aquí viven las funciones; el flujo
 * durable que las invoca llega en la rebanada «Borrado y exportación».
 *
 * El libro nunca se borra: se exporta y la retención suelta particiones.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type postgres from 'postgres';

import { conTenant, identificadorSeguro } from './cliente.js';
import { ORDEN_PURGA, ORDEN_PURGA_IDENTIDAD } from './tablas.js';

/** Tablas que se exportan pero nunca se purgan con la organización. */
export const TABLAS_QUE_SOBREVIVEN = ['entrada_auditoria'] as const;

export interface FicheroExportado {
  tabla: string;
  filas: number;
  ruta: string;
}

/**
 * Exporta cada tabla del tenant a un JSONL. Una línea por fila, formato estable,
 * para que el cliente se lleve sus datos sin depender de nosotros.
 */
export async function exportarOrganizacion(
  cliente: postgres.Sql,
  tenantId: string,
  directorio: string,
): Promise<FicheroExportado[]> {
  mkdirSync(directorio, { recursive: true });
  const tablas = [...ORDEN_PURGA, ...TABLAS_QUE_SOBREVIVEN];
  const exportados: FicheroExportado[] = [];

  await conTenant(cliente, tenantId, async (tx) => {
    for (const tabla of tablas) {
      const nombre = identificadorSeguro(tabla);
      const columna = nombre === 'organizacion' ? 'id' : 'tenant_id';
      const filas = await tx.unsafe<Record<string, unknown>[]>(
        `select * from ${nombre} where ${columna} = $1`,
        [tenantId],
      );
      const ruta = join(directorio, `${nombre}.jsonl`);
      writeFileSync(ruta, filas.map((fila) => JSON.stringify(fila)).join('\n'), 'utf8');
      exportados.push({ tabla: nombre, filas: filas.length, ruta });
    }
  });

  return exportados;
}

/**
 * Purga una organización entera. Deja cero filas en todas las tablas del tenant
 * salvo el libro de auditoría, que queda exportado y a expensas de la retención.
 *
 * El primer paso deshace los punteros que apuntan dentro de la propia jerarquía;
 * sin él, el borrado restringido rechaza el `DELETE` aunque el referenciante se
 * borre en la misma sentencia. Ese rechazo es el comportamiento que se quiere:
 * purgar en otro orden falla.
 */
export async function purgarOrganizacion(
  cliente: postgres.Sql,
  tenantId: string,
): Promise<Record<string, number>> {
  const borradas: Record<string, number> = {};

  await conTenant(cliente, tenantId, async (tx) => {
    // La identidad primero: `usuario` y `sesion` referencian persona y organización.
    for (const { tabla, porUsuario } of ORDEN_PURGA_IDENTIDAD) {
      const nombre = identificadorSeguro(tabla);
      const resultado = porUsuario
        ? await tx.unsafe(
            `delete from ${nombre} where usuario_id in (select id from usuario where tenant_id = $1)`,
            [tenantId],
          )
        : await tx.unsafe(`delete from ${nombre} where tenant_id = $1`, [tenantId]);
      borradas[nombre] = resultado.count;
    }
    await soltarPunteros(tx, tenantId);
    for (const tabla of ORDEN_PURGA) {
      const nombre = identificadorSeguro(tabla);
      const columna = nombre === 'organizacion' ? 'id' : 'tenant_id';
      const resultado = await tx.unsafe(`delete from ${nombre} where ${columna} = $1`, [tenantId]);
      borradas[nombre] = resultado.count;
    }
  });

  return borradas;
}

/** Deshace los punteros internos que impiden borrar en bloque. */
async function soltarPunteros(tx: postgres.TransactionSql, tenantId: string): Promise<void> {
  await tx`update tarea set tarea_padre_id = null, tarea_raiz_id = null where tenant_id = ${tenantId}`;
  await tx`update departamento set supervisor_puesto_id = null where tenant_id = ${tenantId}`;
  await tx`update puesto set version_activa_id = null where tenant_id = ${tenantId}`;
}

/**
 * Tablas que cuelgan de un puesto por una columna directa, en el orden en que hay
 * que vaciarlas. Las que cuelgan a través de la lección se borran aparte.
 */
const ORDEN_PURGA_PUESTO: readonly { tabla: string; columna: string }[] = [
  { tabla: 'mensaje', columna: 'autor_puesto_id' },
  { tabla: 'sala_participante', columna: 'puesto_id' },
  { tabla: 'leccion', columna: 'puesto_id' },
  { tabla: 'senal', columna: 'puesto_id' },
  { tabla: 'disparador', columna: 'puesto_id' },
  { tabla: 'autorizacion_herramientas', columna: 'puesto_id' },
  { tabla: 'propuesta_operacion', columna: 'actor_puesto_id' },
];

export interface ResultadoPurgaPuesto {
  borradas: Record<string, number>;
}

/**
 * Da de baja un agente: borra lo que cuelga de su puesto y el puesto.
 * Las entradas de auditoría del agente se quedan: referencian por identificador.
 */
export async function purgarPuesto(
  cliente: postgres.Sql,
  tenantId: string,
  puestoId: string,
): Promise<ResultadoPurgaPuesto> {
  const borradas: Record<string, number> = {};

  await conTenant(cliente, tenantId, async (tx) => {
    // Los departamentos que lo tenían de supervisor dejan de apuntarlo.
    await tx`
      update departamento set supervisor_puesto_id = null
      where tenant_id = ${tenantId} and supervisor_puesto_id = ${puestoId}
    `;
    await tx`
      update puesto set version_activa_id = null
      where tenant_id = ${tenantId} and id = ${puestoId}
    `;
    // Las tareas del puesto y todo lo que cuelga de ellas.
    await tx`
      update tarea set tarea_padre_id = null, tarea_raiz_id = null
      where tenant_id = ${tenantId} and puesto_id = ${puestoId}
    `;
    const intervenciones = await tx`
      delete from intervencion
      where tenant_id = ${tenantId}
        and (moderador_puesto_id = ${puestoId}
          or tarea_id in (select id from tarea where tenant_id = ${tenantId} and puesto_id = ${puestoId}))
    `;
    borradas['intervencion'] = intervenciones.count;
    // La decisión cuelga de la aprobación: se vacía antes, o el borrado restringido
    // rechaza el de la aprobación.
    const decisiones = await tx`
      delete from decision_aprobacion
      where tenant_id = ${tenantId}
        and aprobacion_id in (
          select a.id from aprobacion a
          join tarea t on t.id = a.tarea_id and t.tenant_id = a.tenant_id
          where a.tenant_id = ${tenantId} and t.puesto_id = ${puestoId}
        )
    `;
    borradas['decision_aprobacion'] = decisiones.count;
    const aprobaciones = await tx`
      delete from aprobacion
      where tenant_id = ${tenantId}
        and tarea_id in (select id from tarea where tenant_id = ${tenantId} and puesto_id = ${puestoId})
    `;
    borradas['aprobacion'] = aprobaciones.count;
    const delegaciones = await tx`
      delete from delegacion
      where tenant_id = ${tenantId}
        and (puesto_origen_id = ${puestoId} or puesto_destino_id = ${puestoId})
    `;
    borradas['delegacion'] = delegaciones.count;
    const pasos = await tx`
      delete from paso
      where tenant_id = ${tenantId}
        and tarea_id in (select id from tarea where tenant_id = ${tenantId} and puesto_id = ${puestoId})
    `;
    borradas['paso'] = pasos.count;
    const tareas = await tx`
      delete from tarea where tenant_id = ${tenantId} and puesto_id = ${puestoId}
    `;
    borradas['tarea'] = tareas.count;

    // Lo que cuelga de las lecciones del puesto, antes que las propias lecciones.
    const promociones = await tx`
      delete from promocion
      where tenant_id = ${tenantId}
        and leccion_id in (select id from leccion where tenant_id = ${tenantId} and puesto_id = ${puestoId})
    `;
    borradas['promocion'] = promociones.count;
    const leccionesSenales = await tx`
      delete from leccion_senal
      where tenant_id = ${tenantId}
        and leccion_id in (select id from leccion where tenant_id = ${tenantId} and puesto_id = ${puestoId})
    `;
    borradas['leccion_senal'] = leccionesSenales.count;

    for (const { tabla, columna } of ORDEN_PURGA_PUESTO) {
      const nombre = identificadorSeguro(tabla);
      const col = identificadorSeguro(columna);
      const r = await tx.unsafe(`delete from ${nombre} where tenant_id = $1 and ${col} = $2`, [
        tenantId,
        puestoId,
      ]);
      borradas[nombre] = r.count;
    }

    const versiones = await tx`
      delete from habilidad_version_puesto
      where tenant_id = ${tenantId}
        and version_puesto_id in (select id from version_puesto where tenant_id = ${tenantId} and puesto_id = ${puestoId})
    `;
    borradas['habilidad_version_puesto'] = versiones.count;
    const versionesPuesto = await tx`
      delete from version_puesto where tenant_id = ${tenantId} and puesto_id = ${puestoId}
    `;
    borradas['version_puesto'] = versionesPuesto.count;
    const puestos = await tx`
      delete from puesto where tenant_id = ${tenantId} and id = ${puestoId}
    `;
    borradas['puesto'] = puestos.count;
  });

  return { borradas };
}

/** Exporta el expediente de un agente: su puesto, sus versiones y lo que produjo. */
export async function exportarPuesto(
  cliente: postgres.Sql,
  tenantId: string,
  puestoId: string,
  directorio: string,
): Promise<FicheroExportado[]> {
  mkdirSync(directorio, { recursive: true });
  const exportados: FicheroExportado[] = [];

  const consultas: readonly { tabla: string; sql: string }[] = [
    { tabla: 'puesto', sql: 'select * from puesto where tenant_id = $1 and id = $2' },
    {
      tabla: 'version_puesto',
      sql: 'select * from version_puesto where tenant_id = $1 and puesto_id = $2',
    },
    { tabla: 'tarea', sql: 'select * from tarea where tenant_id = $1 and puesto_id = $2' },
    { tabla: 'senal', sql: 'select * from senal where tenant_id = $1 and puesto_id = $2' },
    { tabla: 'leccion', sql: 'select * from leccion where tenant_id = $1 and puesto_id = $2' },
    {
      tabla: 'entrada_auditoria',
      sql: 'select * from entrada_auditoria where tenant_id = $1 and puesto_id = $2 order by numero_orden',
    },
  ];

  await conTenant(cliente, tenantId, async (tx) => {
    for (const { tabla, sql } of consultas) {
      const filas = await tx.unsafe<Record<string, unknown>[]>(sql, [tenantId, puestoId]);
      const ruta = join(directorio, `${tabla}.jsonl`);
      writeFileSync(ruta, filas.map((fila) => JSON.stringify(fila)).join('\n'), 'utf8');
      exportados.push({ tabla, filas: filas.length, ruta });
    }
  });

  return exportados;
}
