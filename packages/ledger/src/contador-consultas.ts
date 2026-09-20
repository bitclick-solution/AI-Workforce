/**
 * Consultas de lectura del contador para el panel.
 *
 * Todas se ejecutan dentro de una transacción con el tenant fijado (`conTenant` de
 * `@aiw/db`): el aislamiento lo da la política de RLS y no un `where tenant_id` que
 * alguien pueda olvidar. El filtro por tenant que sí aparece está para que el plan
 * de consulta use los índices compuestos, no para aislar.
 *
 * El coste de una tarea se agrega desde `uso_modelo` por tarea raíz, así que el
 * consumo de una delegación aparece en la tarea que la pidió (ADR-003) sin que nadie
 * mantenga un acumulado a mano.
 */
import type postgres from 'postgres';

export interface ConsumoDelPeriodo {
  /** Primer día del mes en curso, que es el periodo del contador. */
  periodo: string;
  tareas: number;
  pasos: number;
  acciones: number;
  /** Coste acumulado en el contador: lo que han sumado todas las acciones. */
  costeEuros: number;
  /** Coste de modelos del periodo, agregado desde los usos reales. */
  costeModelosEuros: number;
  /** Número de orden más alto del libro: el panel detecta cambios comparando enteros. */
  ultimaAnotacion: number;
  /** Hora de la base en la que se leyó, para que el panel sepa si el dato es rancio. */
  momento: string;
}

/**
 * Consumo del periodo en curso en una sola ida y vuelta.
 *
 * Un tenant sin fila en `contador_consumo` todavía no ha hecho nada: devuelve ceros
 * en vez de nada, porque un panel vacío y un panel a cero son la misma verdad y el
 * segundo no obliga a nadie a distinguirlos.
 */
export async function consumoDelPeriodo(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
): Promise<ConsumoDelPeriodo> {
  const [fila] = await tx<
    {
      periodo: string;
      tareas: string;
      pasos: string;
      acciones: string;
      coste_euros: string;
      coste_modelos_euros: string;
      ultima_anotacion: string;
      momento: Date;
    }[]
  >`
    with periodo as (select date_trunc('month', now())::date as dia)
    select
      (select dia from periodo)::text as periodo,
      coalesce(c.tareas, 0)::text as tareas,
      coalesce(c.pasos, 0)::text as pasos,
      coalesce(c.acciones, 0)::text as acciones,
      coalesce(c.coste_euros, 0)::text as coste_euros,
      coalesce((
        select sum(u.coste_euros)
        from uso_modelo u
        where u.tenant_id = ${tenantId}
          and u.creado_en >= (select dia from periodo)
      ), 0)::text as coste_modelos_euros,
      coalesce((
        select max(e.numero_orden)
        from entrada_auditoria e
        where e.tenant_id = ${tenantId}
      ), 0)::text as ultima_anotacion,
      now() as momento
    from periodo
    left join contador_consumo c
      on c.tenant_id = ${tenantId} and c.periodo = (select dia from periodo)
  `;
  if (!fila) throw new Error('La base no devolvió el consumo del periodo.');

  return {
    periodo: fila.periodo,
    tareas: Number(fila.tareas),
    pasos: Number(fila.pasos),
    acciones: Number(fila.acciones),
    costeEuros: Number(fila.coste_euros),
    costeModelosEuros: Number(fila.coste_modelos_euros),
    ultimaAnotacion: Number(fila.ultima_anotacion),
    momento: fila.momento.toISOString(),
  };
}

export interface TareaRaizDelPeriodo {
  tareaId: string;
  puestoId: string;
  puesto: string;
  estado: string;
  origen: string;
  creadoEn: string;
  costeModelosEuros: number;
  usos: number;
  /** Cuántas tareas cuelgan de esta: delegaciones cuyo consumo ya está sumado aquí. */
  delegaciones: number;
}

export interface TareasDelPeriodo {
  tareas: TareaRaizDelPeriodo[];
  /** Reparto por estado de **todas** las raíces del periodo, no solo de las devueltas. */
  porEstado: Record<string, number>;
  total: number;
}

/**
 * Tareas raíz del periodo con su coste de modelos, su estado y su puesto.
 *
 * El reparto por estado va aparte y sin límite porque es lo que hace falta para
 * decidir si las tareas que acaban en error se descuentan del cupo: con la lista
 * recortada no se puede responder a esa pregunta.
 */
export async function tareasDelPeriodo(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  limite = 50,
): Promise<TareasDelPeriodo> {
  const tope = Math.min(Math.max(Math.trunc(limite), 1), 200);

  const filas = await tx<
    {
      tarea_id: string;
      puesto_id: string;
      puesto: string;
      estado: string;
      origen: string;
      creado_en: Date;
      coste_modelos_euros: string;
      usos: string;
      delegaciones: string;
    }[]
  >`
    select
      t.id as tarea_id,
      t.puesto_id,
      p.nombre as puesto,
      t.estado::text as estado,
      t.origen::text as origen,
      t.creado_en,
      coalesce(u.coste, 0)::text as coste_modelos_euros,
      coalesce(u.usos, 0)::text as usos,
      coalesce(d.hijas, 0)::text as delegaciones
    from tarea t
    join puesto p on p.id = t.puesto_id and p.tenant_id = t.tenant_id
    left join lateral (
      select sum(x.coste_euros) as coste, count(*) as usos
      from uso_modelo x
      where x.tenant_id = t.tenant_id and x.tarea_raiz_id = t.id
    ) u on true
    left join lateral (
      select count(*) as hijas
      from tarea h
      where h.tenant_id = t.tenant_id and h.tarea_raiz_id = t.id and h.id <> t.id
    ) d on true
    where t.tenant_id = ${tenantId}
      and coalesce(t.tarea_raiz_id, t.id) = t.id
      and t.creado_en >= date_trunc('month', now())
    order by t.creado_en desc
    limit ${tope}
  `;

  const porEstadoFilas = await tx<{ estado: string; total: string }[]>`
    select t.estado::text as estado, count(*)::text as total
    from tarea t
    where t.tenant_id = ${tenantId}
      and coalesce(t.tarea_raiz_id, t.id) = t.id
      and t.creado_en >= date_trunc('month', now())
    group by t.estado
    order by 1
  `;

  const porEstado: Record<string, number> = {};
  let total = 0;
  for (const fila of porEstadoFilas) {
    porEstado[fila.estado] = Number(fila.total);
    total += Number(fila.total);
  }

  return {
    tareas: filas.map((fila) => ({
      tareaId: fila.tarea_id,
      puestoId: fila.puesto_id,
      puesto: fila.puesto,
      estado: fila.estado,
      origen: fila.origen,
      creadoEn: fila.creado_en.toISOString(),
      costeModelosEuros: Number(fila.coste_modelos_euros),
      usos: Number(fila.usos),
      delegaciones: Number(fila.delegaciones),
    })),
    porEstado,
    total,
  };
}

export interface CostePorPuesto {
  puestoId: string;
  puesto: string;
  costeModelosEuros: number;
  tokensEntrada: number;
  tokensSalida: number;
  usos: number;
}

/** Coste de modelos del periodo por puesto: qué puesto se está comiendo el consumo. */
export async function costePorPuesto(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
): Promise<CostePorPuesto[]> {
  const filas = await tx<
    {
      puesto_id: string;
      puesto: string;
      coste: string;
      tokens_entrada: string;
      tokens_salida: string;
      usos: string;
    }[]
  >`
    select
      u.puesto_id,
      p.nombre as puesto,
      sum(u.coste_euros)::text as coste,
      sum(u.tokens_entrada + u.tokens_entrada_cache)::text as tokens_entrada,
      sum(u.tokens_salida)::text as tokens_salida,
      count(*)::text as usos
    from uso_modelo u
    join puesto p on p.id = u.puesto_id and p.tenant_id = u.tenant_id
    where u.tenant_id = ${tenantId}
      and u.creado_en >= date_trunc('month', now())
    group by u.puesto_id, p.nombre
    order by sum(u.coste_euros) desc
  `;

  return filas.map((fila) => ({
    puestoId: fila.puesto_id,
    puesto: fila.puesto,
    costeModelosEuros: Number(fila.coste),
    tokensEntrada: Number(fila.tokens_entrada),
    tokensSalida: Number(fila.tokens_salida),
    usos: Number(fila.usos),
  }));
}

export interface CosteDeTarea {
  tareaRaizId: string;
  costeModelosEuros: number;
  tokensEntrada: number;
  tokensSalida: number;
  usos: number;
}

/**
 * Coste de una tarea raíz, delegaciones incluidas.
 *
 * No lee `tarea.coste_euros`: esa columna la rellenará la proyección desde Temporal,
 * y hasta entonces la verdad son los usos. Agregarlos evita además que dos sitios
 * cuenten lo mismo y discrepen.
 */
export async function costeDeTareaRaiz(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  tareaRaizId: string,
): Promise<CosteDeTarea> {
  const [fila] = await tx<
    { coste: string; tokens_entrada: string; tokens_salida: string; usos: string }[]
  >`
    select
      coalesce(sum(coste_euros), 0)::text as coste,
      coalesce(sum(tokens_entrada + tokens_entrada_cache), 0)::text as tokens_entrada,
      coalesce(sum(tokens_salida), 0)::text as tokens_salida,
      count(*)::text as usos
    from uso_modelo
    where tenant_id = ${tenantId} and tarea_raiz_id = ${tareaRaizId}
  `;

  return {
    tareaRaizId,
    costeModelosEuros: Number(fila?.coste ?? 0),
    tokensEntrada: Number(fila?.tokens_entrada ?? 0),
    tokensSalida: Number(fila?.tokens_salida ?? 0),
    usos: Number(fila?.usos ?? 0),
  };
}

/** Lo que el panel necesita de una vez: consumo, tareas y coste por puesto. */
export interface PanelDelContador {
  consumo: ConsumoDelPeriodo;
  tareas: TareasDelPeriodo;
  porPuesto: CostePorPuesto[];
}

export async function panelDelContador(
  tx: postgres.TransactionSql | postgres.Sql,
  tenantId: string,
  limiteTareas = 20,
): Promise<PanelDelContador> {
  return {
    consumo: await consumoDelPeriodo(tx, tenantId),
    tareas: await tareasDelPeriodo(tx, tenantId, limiteTareas),
    porPuesto: await costePorPuesto(tx, tenantId),
  };
}
