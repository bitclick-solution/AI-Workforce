-- Promoción de varias versiones: una lección de departamento deja una versión nueva
-- en cada puesto del departamento (rebanada «Supervisor de departamento y memoria
-- compartida en Finanzas», decisión 7 de la especificación; Jesús, 2-10-2026).
--
-- `promocion` sigue siendo una fila por lección (índice único de la `0002`) y su
-- `version_puesto_resultante_id` sigue apuntando a la versión del puesto que originó
-- la lección. Esta tabla cuelga de la promoción las versiones que crea: una fila por
-- puesto. Una promoción de puesto no escribe aquí, así que lo que ya existe no cambia.
--
-- Inmutable como `promocion` y `version_puesto` (ADR-007): se inserta y no se
-- actualiza. La reversión por puesto no la toca: mueve el puntero del puesto, y la
-- versión de destino ya existe.
--
-- Solo crea una tabla. No altera ninguna otra ni toca datos existentes.
--
-- Se aplica con `pnpm --filter @aiw/db db:migrar` y se deshace con `db:revertir`
-- (que deshace todas); su reverso suelto está en `reverso/0011_promocion_version.sql`.

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

set local role aiw_migrador;
--> statement-breakpoint

create table promocion_version (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  promocion_id uuid not null references promocion (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  version_puesto_id uuid not null references version_puesto (id) on delete restrict,
  version_anterior_id uuid not null references version_puesto (id) on delete restrict,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint

-- Un puesto recibe como mucho una versión por promoción, y una versión nace de una
-- sola promoción.
create unique index promocion_version_tenant_promocion_puesto_key
  on promocion_version (tenant_id, promocion_id, puesto_id);
--> statement-breakpoint
create unique index promocion_version_tenant_version_key
  on promocion_version (tenant_id, version_puesto_id);
--> statement-breakpoint
create index promocion_version_tenant_puesto_idx
  on promocion_version (tenant_id, puesto_id, creado_en);
--> statement-breakpoint

alter table promocion_version enable row level security;
--> statement-breakpoint
alter table promocion_version force row level security;
--> statement-breakpoint
create policy promocion_version_tenant on promocion_version
  using (tenant_id = aiw_tenant_actual())
  with check (tenant_id = aiw_tenant_actual());
--> statement-breakpoint

grant select, insert on promocion_version to aiw_app;
--> statement-breakpoint

create trigger promocion_version_sin_actualizar
  before update on promocion_version
  for each row execute function aiw_fila_inmutable();
