-- Reverso de Modelos v1. Deja la base como estaba antes de `0003_modelos_v1.sql`:
-- sin las columnas de modelo, esfuerzo y plataforma, y con la única de
-- `tarifa_modelo` como antes.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

alter table uso_modelo
  drop column if exists plataforma;
--> statement-breakpoint

drop index if exists tarifa_modelo_tenant_modelo_plataforma_vigencia_key;
--> statement-breakpoint
create unique index tarifa_modelo_tenant_modelo_vigencia_key
  on tarifa_modelo (tenant_id, proveedor, modelo, vigente_desde);
--> statement-breakpoint

alter table tarifa_modelo
  drop constraint if exists tarifa_modelo_plataforma_no_vacia,
  drop constraint if exists tarifa_modelo_multiplicador_positivo;
--> statement-breakpoint

alter table tarifa_modelo
  drop column if exists plataforma,
  drop column if exists multiplicador_lista_oficial;
--> statement-breakpoint

alter table version_puesto
  drop column if exists configuracion_modelo;
--> statement-breakpoint

reset role;
--> statement-breakpoint
