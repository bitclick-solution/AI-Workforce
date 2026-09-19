/**
 * Carga sintética y banco de consultas del panel.
 *
 * El plan exige probar el modelo con un millón de entradas de auditoría y cien mil
 * mensajes de sala en un tenant, y que las consultas del panel respondan por debajo
 * de 200 ms en el percentil 95 antes de construir encima.
 *
 * Las filas se generan con `generate_series` dentro de la base: ningún dato viaja
 * por la red. La cadena de hash de estas entradas es sintética y coherente en
 * estructura (cada entrada apunta al hash de la anterior), pero no la calcula el
 * punto único de escritura: la cadena real se comprueba en las pruebas de `@aiw/ledger`.
 */
import type postgres from 'postgres';

import { conTenant } from './cliente.js';

export interface OpcionesCarga {
  entradasAuditoria: number;
  mensajes: number;
  salaId: string;
  puestoId: string;
}

export interface ResultadoCarga {
  entradasAuditoria: number;
  mensajes: number;
  milisegundos: number;
}

export async function generarCarga(
  cliente: postgres.Sql,
  tenantId: string,
  opciones: OpcionesCarga,
): Promise<ResultadoCarga> {
  const comienzo = Date.now();

  await conTenant(cliente, tenantId, async (tx) => {
    await tx`
      insert into entrada_auditoria (
        tenant_id, numero_orden, actor_tipo, puesto_id, accion, herramienta,
        datos_referenciados, resultado, coste_euros, duracion_ms,
        hash_anterior, hash, creado_en
      )
      select
        ${tenantId},
        n,
        'agente'::tipo_actor,
        ${opciones.puestoId},
        'sintetica.' || (n % 17),
        'herramienta.' || (n % 7),
        '[]'::jsonb,
        (array['exito', 'error', 'rechazado', 'parcial'])[1 + (n % 4)]::resultado_accion,
        round((n % 97)::numeric / 100, 4),
        (n % 1500),
        encode(sha256((${tenantId} || ':' || (n - 1))::bytea), 'hex'),
        encode(sha256((${tenantId} || ':' || n)::bytea), 'hex'),
        date_trunc('month', now()) + ((n % 28) * interval '1 day') + ((n % 86400) * interval '1 second')
      from generate_series(1, ${opciones.entradasAuditoria}) as n
    `;

    await tx`
      insert into mensaje (tenant_id, sala_id, cuerpo, adjuntos, creado_en)
      select
        ${tenantId},
        ${opciones.salaId},
        'Mensaje sintético ' || n,
        '[]'::jsonb,
        date_trunc('month', now()) + ((n % 28) * interval '1 day') + ((n % 86400) * interval '1 second')
      from generate_series(1, ${opciones.mensajes}) as n
    `;

    await tx`analyze entrada_auditoria`;
    await tx`analyze mensaje`;
  });

  return {
    entradasAuditoria: opciones.entradasAuditoria,
    mensajes: opciones.mensajes,
    milisegundos: Date.now() - comienzo,
  };
}

export interface ConsultaPanel {
  nombre: string;
  sql: string;
  parametros: (tenantId: string, contexto: ContextoPanel) => unknown[];
}

export interface ContextoPanel {
  puestoId: string;
  salaId: string;
  personaId: string;
}

/** Las cuatro consultas que dibuja el panel en cada carga de página. */
export const CONSULTAS_PANEL: readonly ConsultaPanel[] = [
  {
    nombre: 'últimas entradas de auditoría del puesto',
    sql: `select id, accion, resultado, coste_euros, creado_en
          from entrada_auditoria
          where tenant_id = $1 and puesto_id = $2
          order by creado_en desc
          limit 50`,
    parametros: (tenantId, ctx) => [tenantId, ctx.puestoId],
  },
  {
    nombre: 'contador del periodo',
    sql: `select tareas, pasos, acciones, coste_euros
          from contador_consumo
          where tenant_id = $1 and periodo = date_trunc('month', now())::date`,
    parametros: (tenantId) => [tenantId],
  },
  {
    nombre: 'últimos mensajes de la sala',
    sql: `select id, cuerpo, creado_en
          from mensaje
          where tenant_id = $1 and sala_id = $2
          order by creado_en desc
          limit 100`,
    parametros: (tenantId, ctx) => [tenantId, ctx.salaId],
  },
  {
    nombre: 'aprobaciones pendientes de la persona',
    sql: `select id, resumen_legible, creado_en
          from aprobacion
          where tenant_id = $1 and persona_id = $2 and decision = 'pendiente'
          order by creado_en desc
          limit 50`,
    parametros: (tenantId, ctx) => [tenantId, ctx.personaId],
  },
];

export interface MedidaConsulta {
  nombre: string;
  repeticiones: number;
  p50: number;
  p95: number;
  maximo: number;
  plan: string;
}

function percentil(valores: readonly number[], p: number): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)] ?? 0;
}

/** Ejecuta el banco de consultas y devuelve percentiles y plan de cada una. */
export async function medirPanel(
  cliente: postgres.Sql,
  tenantId: string,
  contexto: ContextoPanel,
  repeticiones = 50,
): Promise<MedidaConsulta[]> {
  const medidas: MedidaConsulta[] = [];

  await conTenant(cliente, tenantId, async (tx) => {
    for (const consulta of CONSULTAS_PANEL) {
      const parametros = consulta.parametros(tenantId, contexto);
      // Calentamiento: el primer acceso paga la caché de páginas.
      await tx.unsafe(consulta.sql, parametros as never[]);

      const tiempos: number[] = [];
      for (let i = 0; i < repeticiones; i += 1) {
        const comienzo = process.hrtime.bigint();
        await tx.unsafe(consulta.sql, parametros as never[]);
        tiempos.push(Number(process.hrtime.bigint() - comienzo) / 1_000_000);
      }

      const filasPlan = await tx.unsafe<{ 'QUERY PLAN': string }[]>(
        `explain ${consulta.sql}`,
        parametros as never[],
      );
      medidas.push({
        nombre: consulta.nombre,
        repeticiones,
        p50: percentil(tiempos, 50),
        p95: percentil(tiempos, 95),
        maximo: Math.max(...tiempos),
        plan: filasPlan.map((f) => f['QUERY PLAN']).join('\n'),
      });
    }
  });

  return medidas;
}
