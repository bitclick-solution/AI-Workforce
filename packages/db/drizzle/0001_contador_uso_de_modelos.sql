-- Contador de tareas v0: usos reales de modelo y tarifas versionadas (ADR-003, ADR-011).
--
-- Añade las dos tablas que el modelo v1 no tenía: dónde se registra cada llamada al
-- modelo con sus tokens reales, y cuánto cuesta ese modelo según una tarifa que es
-- dato versionado y no una constante en el código.
--
-- Autocontenida: solo usa objetos de la migración inicial (roles, uuid_generar_v7(),
-- aiw_tenant_actual(), aiw_fila_inmutable(), organizacion, tarea, paso, puesto y
-- version_puesto). No altera ninguna tabla existente, así que no depende del orden
-- respecto a otras migraciones 000N que lleguen de otra rebanada.
--
-- Se aplica con `pnpm --filter @aiw/db db:migrar` y se deshace con `db:revertir`.

do $$
begin
  execute format('grant aiw_migrador to %I', current_user);
exception
  when insufficient_privilege then
    raise exception
      'El usuario % no puede asumir aiw_migrador. Dale la pertenencia con «grant aiw_migrador to %» desde un rol con opción de administración y repite la migración.',
      current_user, current_user;
end
$$;
--> statement-breakpoint

-- Local a la transacción de la migración: las tablas nuevas quedan a nombre de
-- aiw_migrador y no del usuario que migró ese día.
set local role aiw_migrador;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tarifa de modelo: dato versionado por tenant, nunca código.
--
-- Sin columna de cierre de vigencia a propósito: cerrar una vigencia sería un
-- UPDATE sobre una fila inmutable. El cierre es la fila siguiente, y la tarifa
-- aplicable a un uso es la de mayor `vigente_desde` que no sea posterior a él.
-- ---------------------------------------------------------------------------
create table tarifa_modelo (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  proveedor text not null,
  modelo text not null,
  euros_por_millon_entrada numeric(14, 6) not null,
  euros_por_millon_salida numeric(14, 6) not null,
  euros_por_millon_entrada_cache numeric(14, 6) not null default 0,
  vigente_desde timestamptz not null,
  -- De dónde sale el precio: lista pública, contrato o acuerdo con el partner.
  fuente text not null,
  creado_en timestamptz not null default now(),
  constraint tarifa_modelo_precios_no_negativos check (
    euros_por_millon_entrada >= 0
    and euros_por_millon_salida >= 0
    and euros_por_millon_entrada_cache >= 0
  ),
  constraint tarifa_modelo_proveedor_modelo_no_vacios check (
    length(btrim(proveedor)) > 0 and length(btrim(modelo)) > 0
  )
);
--> statement-breakpoint

create unique index tarifa_modelo_tenant_modelo_vigencia_key
  on tarifa_modelo (tenant_id, proveedor, modelo, vigente_desde);
--> statement-breakpoint
create index tarifa_modelo_tenant_vigencia_idx
  on tarifa_modelo (tenant_id, vigente_desde desc);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Uso de modelo: una fila por llamada, con los tokens reales y el coste congelado.
--
-- `clave_idempotencia` es lo que hace que el reintento de una actividad de Temporal
-- no cobre dos veces: la única sobre (tenant_id, clave_idempotencia) la impone la
-- base, no una convención del repositorio.
-- ---------------------------------------------------------------------------
create table uso_modelo (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tarea_id uuid not null references tarea (id) on delete restrict,
  -- La raíz de consumo: el coste de una delegación se agrega a la tarea que la pidió.
  tarea_raiz_id uuid not null references tarea (id) on delete restrict,
  paso_id uuid references paso (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  version_puesto_id uuid not null references version_puesto (id) on delete restrict,
  proveedor text not null,
  modelo text not null,
  tokens_entrada bigint not null default 0,
  tokens_salida bigint not null default 0,
  tokens_entrada_cache bigint not null default 0,
  llamadas integer not null default 1,
  tarifa_modelo_id uuid not null references tarifa_modelo (id) on delete restrict,
  coste_euros numeric(12, 4) not null default 0,
  clave_idempotencia text not null,
  creado_en timestamptz not null default now(),
  constraint uso_modelo_tokens_no_negativos check (
    tokens_entrada >= 0 and tokens_salida >= 0 and tokens_entrada_cache >= 0
  ),
  constraint uso_modelo_llamadas_positivas check (llamadas > 0),
  constraint uso_modelo_coste_no_negativo check (coste_euros >= 0),
  constraint uso_modelo_clave_no_vacia check (length(btrim(clave_idempotencia)) > 0)
);
--> statement-breakpoint

create unique index uso_modelo_tenant_clave_key on uso_modelo (tenant_id, clave_idempotencia);
--> statement-breakpoint
create index uso_modelo_tenant_creado_idx on uso_modelo (tenant_id, creado_en desc);
--> statement-breakpoint
create index uso_modelo_tenant_raiz_idx on uso_modelo (tenant_id, tarea_raiz_id);
--> statement-breakpoint
create index uso_modelo_tenant_puesto_creado_idx
  on uso_modelo (tenant_id, puesto_id, creado_en desc);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila, también para el propietario del esquema.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
  v_tablas text[] := array['tarifa_modelo', 'uso_modelo'];
begin
  foreach v_tabla in array v_tablas loop
    execute format('alter table %I enable row level security', v_tabla);
    execute format('alter table %I force row level security', v_tabla);
    execute format(
      'create policy %I on %I using (tenant_id = aiw_tenant_actual()) with check (tenant_id = aiw_tenant_actual())',
      v_tabla || '_tenant', v_tabla
    );
  end loop;
end
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Permisos e inmutabilidad. El `grant ... on all tables` de la migración inicial
-- no alcanza a las tablas creadas después: aquí se conceden los permisos de una
-- en una, y solo los que hacen falta.
--
-- Un consumo ya registrado y un precio ya aplicado no se corrigen editándolos:
-- la corrección es una fila nueva (ADR-005, ADR-007).
-- ---------------------------------------------------------------------------
grant select, insert on tarifa_modelo to aiw_app;
--> statement-breakpoint
grant select, insert on uso_modelo to aiw_app;
--> statement-breakpoint

create trigger tarifa_modelo_sin_actualizar
  before update on tarifa_modelo
  for each row execute function aiw_fila_inmutable();
--> statement-breakpoint
create trigger uso_modelo_sin_actualizar
  before update on uso_modelo
  for each row execute function aiw_fila_inmutable();
--> statement-breakpoint
